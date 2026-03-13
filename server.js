const express = require("express");
const pool = require("./database/db");
const {
    obtenerEquiposPorGrupo,
    simularFaseDeGrupos,
    simularGruposSeleccionados,
    generarCrucesDieciseisavos,
} = require("./services/simulator");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const STOP_WORDS = new Set([
    "cual", "cuales", "quien", "quienes", "como", "donde", "cuando", "que", "es", "son",
    "fue", "sera", "seran", "el", "la", "los", "las", "un", "una", "unos", "unas", "de",
    "del", "en", "al", "con", "por", "para", "y", "o", "pero", "si", "no", "me", "te", "le",
    "se", "lo", "hay", "tiene", "tienen", "esta", "estan", "era", "eran", "mas", "menos",
    "muy", "mucho", "poco", "tanto", "tal", "cual", "cuanto", "quiero", "saber", "dime",
    "dices", "sabes", "sabe", "sobre", "acerca", "info", "informacion",
    // Domain words too generic — matching them causes false positives
    "mundial", "2026", "seleccion", "selecciones", "copa", "futbol", "torneo",
    "equipo", "equipos", "jugador", "jugadores", "partido", "partidos", "oficial",
    "pais", "paises", "nacion", "naciones", "sede", "sedes", "ciudad", "ciudades"
]);

let ctxActivo = null;

const TEMAS_AMBIGUOS = [
    {
        test: /mejor (jugador|futbolista|crack)/,
        clarificacion: "A que te refieres con el mejor jugador?\n- Del mundo actualmente\n- De la historia del Mundial\n- Del ultimo Mundial (Qatar 2022)",
        opciones: [
            { test: /actualmente|del mundo|hoy|presente|ahora/, respuesta: () => "El mejor jugador del mundo actualmente segun muchos expertos es Vinicius Jr. o Erling Haaland, aunque depende del criterio. Kylian Mbappe sigue siendo candidato eterno." },
            { test: /historia|historico|todos los tiempos|de la historia/, respuesta: () => "El mejor jugador de la historia del Mundial es debatible. Ronaldo Nazario marco 15 goles en 3 mundiales. Pele gano 3 copas. Maradona gano en 1986 casi solo. Messi gano Qatar 2022 y muchos lo consideran el mejor de todos los tiempos." },
            { test: /qatar|2022|ultimo|pasado/, respuesta: () => "En Qatar 2022, el Balon de Oro del torneo fue para Lionel Messi, quien lidero a Argentina al titulo. Kylian Mbappe fue el goleador con 8 goles, incluyendo un hat-trick en la final." },
            { test: /2026|proximo|siguiente/, respuesta: () => "Para el Mundial 2026 los grandes candidatos a brillar son Vinicius Jr., Erling Haaland, Kylian Mbappe, Pedri y Lamine Yamal." },
        ]
    },
    {
        test: /goleador|maxim[oa] goleador|mas goles/,
        clarificacion: "Te refieres al goleador de:\n- La historia del Mundial\n- Qatar 2022\n- El Mundial 2026 (proyeccion)",
        opciones: [
            { test: /historia|historico|todos los tiempos|siempre/, respuesta: () => "El maximo goleador de la historia del Mundial es Miroslav Klose (Alemania) con 16 goles en 4 mundiales. Supero a Ronaldo Nazario que tenia 15." },
            { test: /qatar|2022|ultimo|pasado/, respuesta: () => "El goleador de Qatar 2022 fue Kylian Mbappe con 8 goles, incluyendo un hat-trick en la final ante Argentina." },
            { test: /2026|proximo|siguiente|este/, respuesta: () => "Para el Mundial 2026 los favoritos a ser goleadores son Erling Haaland (Noruega), Kylian Mbappe (Francia) y Vinicius Jr. (Brasil)." },
        ]
    },
    {
        test: /(mejor|mas exitosa|mas titulos|mas copas).{0,10}(seleccion|equipo|pais)/,
        clarificacion: "A que te refieres con la mejor seleccion?\n- La que tiene mas titulos mundiales\n- La mejor actualmente (ranking FIFA)\n- La mejor de la historia",
        opciones: [
            { test: /titulos|copas|campeonatos|gano mas/, respuesta: () => "Brasil es la seleccion con mas titulos mundiales: 5 copas (1958, 1962, 1970, 1994, 2002). Le siguen Alemania e Italia con 4 cada una, y Argentina y Francia con 3." },
            { test: /actualmente|hoy|ranking|ahora/, respuesta: () => "Actualmente Argentina lidera el ranking FIFA, seguida de Francia y Espana. Argentina es campeona vigente desde Qatar 2022." },
            { test: /historia|historico|todos los tiempos/, respuesta: () => "Historicamente Brasil es la seleccion mas exitosa con 5 mundiales. Pero Argentina con sus 3 titulos (el ultimo con Messi) es el gran rival historico." },
        ]
    },
    {
        test: /cuantas? (copas|veces|titulos|mundiales) (gano|ha ganado|tiene|lleva)/,
        clarificacion: "De que seleccion quieres saber sus titulos mundiales? Mencioname el pais o di 'todas' para ver el resumen.",
        opciones: [
            { test: /todas|resumen|completo|lista/, respuesta: () => "Titulos mundiales:\n\nBrasil: 5 (1958,1962,1970,1994,2002)\nAlemania: 4 (1954,1974,1990,2014)\nItalia: 4 (1934,1938,1982,2006)\nArgentina: 3 (1978,1986,2022)\nFrancia: 2 (1998,2018)\nUruguay: 2 (1930,1950)\nInglaterra: 1 (1966)\nEspana: 1 (2010)" },
        ]
    },
    {
        test: /historia del mundial|primer mundial|origen del mundial|como empezo/,
        clarificacion: "Que aspecto de la historia del Mundial te interesa?\n- El primer Mundial (1930)\n- Records y estadisticas historicas\n- Evolucion del formato",
        opciones: [
            { test: /primer|primero|inicio|empezo|origen|1930/, respuesta: () => "El primer Mundial se celebro en Uruguay en 1930. Participaron 13 selecciones. Uruguay gano la final 4-2 a Argentina. Guillermo Stabile fue el primer goleador historico con 8 goles." },
            { test: /record|estadistica|dato|curiosidad/, respuesta: () => "Records historicos del Mundial:\n- Mas goles: Miroslav Klose (16)\n- Mas titulos: Brasil (5)\n- Mas goles en una edicion: Just Fontaine (13, Francia 1958)\n- Unico jugador con 3 titulos: Pele\n- Partido mas goleado: Austria 7-5 Suiza, 1954" },
            { test: /formato|estructura|evolucion|cambio/, respuesta: () => "El Mundial ha crecido: 1930-1938 (13-15 equipos), 1950-1978 (16 equipos), 1982-1994 (24 equipos), 1998-2022 (32 equipos). En 2026 sera el primer Mundial con 48 equipos." },
        ]
    },
    {
        test: /favorito|va a ganar|ganara|campeon (sera|va a ser|2026)/,
        clarificacion: "Cuando hablas del favorito al Mundial 2026, te refieres al:\n- Favorito segun ranking FIFA\n- Favorito segun apuestas\n- Una prediccion general",
        opciones: [
            { test: /ranking|fifa|estadistica/, respuesta: () => "Segun el ranking FIFA actual, el favorito al Mundial 2026 es Argentina (#1), seguida de Francia (#2) y Espana (#3). Brasil y Alemania tambien son candidatos." },
            { test: /apuesta|casa|mercado|probabilidad/, respuesta: () => "En los mercados de apuestas, Francia, Brasil, Argentina e Inglaterra suelen encabezar los favoritos para el Mundial 2026. Inglaterra busca su segundo titulo historico." },
            { test: /predic|crees|opinion|tu|creo|general/, respuesta: () => "Es muy dificil predecir. Argentina es campeona vigente, Francia tiene a Mbappe, y Brasil siempre es candidato. Marruecos demostro en Qatar 2022 que los sorpresivos existen llegando a semis." },
        ]
    },
    {
        test: /que paso en|resultado de|como le fue en|que hizo.*en el mundial/,
        clarificacion: "De que edicion del Mundial quieres saber?\n- Qatar 2022\n- Rusia 2018\n- Brasil 2014",
        opciones: [
            { test: /2022|qatar/, respuesta: () => "Qatar 2022: Campeon Argentina, Subcampeon Francia, Tercero Croacia, Cuarto Marruecos. Goleador: Mbappe (8 goles). Mejor jugador: Messi. Primera semifinal africana (Marruecos)." },
            { test: /2018|rusia/, respuesta: () => "Rusia 2018: Campeon Francia, Subcampeon Croacia, Tercero Belgica, Cuarto Inglaterra. Goleador: Harry Kane (6 goles). Primer Mundial con VAR." },
            { test: /2014|brasil/, respuesta: () => "Brasil 2014: Campeon Alemania, Subcampeon Argentina, Tercero Holanda, Cuarto Brasil. La semifinal Alemania 7-1 Brasil es historica. Goleador: James Rodriguez (6 goles)." },
        ]
    },
    {
        test: /estadio|sede (de la )?final|donde (es|sera) la final/,
        clarificacion: "Buscas informacion sobre:\n- El estadio de la final del Mundial 2026\n- Las ciudades sede\n- Los estadios en general",
        opciones: [
            { test: /final/, respuesta: () => "La final del Mundial 2026 se jugara en el MetLife Stadium en New York/New Jersey, con capacidad para mas de 82,000 espectadores." },
            { test: /ciudad|sede|pais/, respuesta: () => "El Mundial 2026 tiene 16 sedes: 11 en EE.UU., 3 en Mexico (CDMX, Guadalajara, Monterrey) y 2 en Canada (Toronto, Vancouver)." },
            { test: /estadio|recinto|cancha/, respuesta: () => "Estadios destacados: MetLife Stadium (NY/NJ, 82k), Rose Bowl (LA, 93k) y el Estadio Azteca (Mexico, 87k). El Azteca albergara su tercer Mundial (1970, 1986, 2026)." },
        ]
    },
];

function normalizarTexto(texto = "") {
    return texto
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[¿?¡!.,;:()"']/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

const PREFIJOS_ENSENANZA = [
    "aprende que ", "guarda que ", "te digo que ", "anota que ", "recuerda que ",
    "sabe que ", "nota que ", "memoriza que ", "apunta que ", "quiero que sepas que ",
    "te informo que ", "fijate que ", "hay que saber que ", "actualiza que ",
    "corrige que ", "ten en cuenta que ", "registra que ", "agrega que ",
    "nuevo dato que ", "informacion nueva que ",
];

function esEnsenanzaExplicita(texto = "") {
    const t = normalizarTexto(texto);
    return PREFIJOS_ENSENANZA.some(p => t.startsWith(p));
}

function limpiarEnsenanza(texto = "") {
    const t = normalizarTexto(texto);
    for (const p of PREFIJOS_ENSENANZA) {
        if (t.startsWith(p)) return t.slice(p.length).trim();
    }
    return t;
}

function generarClaveConocimiento(texto = "") {
    return normalizarTexto(texto)
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, "_")
        .substring(0, 100)
        .trim();
}

function extraerKeywords(texto = "") {
    return normalizarTexto(texto)
        .split(/\s+/)
        .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
}

function extraerGrupo(pregunta) {
    const match = pregunta.match(/\bgrupo\s+([A-L])\b/i);
    return match ? match[1].toUpperCase() : null;
}

function extraerGruposMultiples(pregunta) {
    const texto = pregunta.toUpperCase();
    const grupos = new Set();
    const regexIndividual = /\bGRUPO\s+([A-L])\b/g;
    let match;
    while ((match = regexIndividual.exec(texto)) !== null) grupos.add(match[1]);
    const regexLista = /\bGRUPOS?\s+([A-L](?:[\s, Y]+[A-L])*)\b/g;
    while ((match = regexLista.exec(texto)) !== null) {
        const letras = match[1].match(/[A-L]/g);
        if (letras) letras.forEach(l => grupos.add(l));
    }
    if (grupos.size === 0 && /\b(SIMULA(R)?|PREDICE)\b/.test(texto)) {
        const letrasSueltas = texto.match(/\b[A-L]\b/g);
        if (letrasSueltas) letrasSueltas.forEach(l => grupos.add(l));
    }
    return [...grupos];
}

function extraerGrupoExcluido(pregunta) {
    const match = pregunta.match(/menos\s+(el\s+)?grupo\s+([A-L])/i);
    return match ? match[2].toUpperCase() : null;
}

function extraerConfederacion(pregunta) {
    const t = normalizarTexto(pregunta);
    const mapa = {
        uefa: "UEFA", conmebol: "CONMEBOL", concacaf: "CONCACAF",
        caf: "CAF", afc: "AFC", ofc: "OFC",
        europe: "UEFA", europa: "UEFA",
        sudamerica: "CONMEBOL", "america del sur": "CONMEBOL",
        africa: "CAF", asia: "AFC",
        "america central": "CONCACAF", "america del norte": "CONCACAF",
        oceania: "OFC",
    };
    for (const [clave, valor] of Object.entries(mapa)) {
        if (t.includes(clave)) return valor;
    }
    return null;
}

function detectarIntent(pregunta) {
    const t = normalizarTexto(pregunta);

    if (esEnsenanzaExplicita(t)) return "ensenar_conocimiento";
    if (/(simular|simula|predice)/.test(t) && extraerGruposMultiples(t).length >= 1) return "simular_grupos";
    if (/(simular|simula|predice|genera|haz)/.test(t) && /(fase de grupos|todos los grupos|clasificados|clasifica|mundial completo)/.test(t)) return "simular_mundial";
    if (/(quien ganaria|quien le gana|quien gana|simulame|simula|enfrentamiento|partido entre|versus|vs)/.test(t) && !/(ranking|grupo|mundial|clasificados)/.test(t)) return "simular_partido";
    if (/(en que grupo esta|en que grupo juega|a que grupo pertenece|que grupo tiene|grupo de)/.test(t)) return "grupo_de_equipo";
    if (/(dame|mostrar|muestrame|ver|cuales|que equipos)/.test(t) && /grupos?/.test(t) && extraerGruposMultiples(t).length >= 2) return "ver_grupos_multiples";
    if (/(dame|mostrar|muestrame|ver|lista|cuales)/.test(t) && /grupos/.test(t) && /menos/.test(t) && /\bgrupo\s+[a-l]\b/i.test(t)) return "ver_grupos_excluyendo";
    if (/\bgrupo\s+[a-l]\b/i.test(t) && /(dame|mostrar|muestrame|ver|cuales|que equipos|equipos|integrantes|conforman)/.test(t)) return "ver_grupo";
    if (/^grupos$/i.test(t) || /(dame|mostrar|ver|lista|cuales|todos los).*(grupos)\b/.test(t)) return "ver_grupos";
    if (/(cuantos equipos|cuantas selecciones|numero de equipos|total de equipos|equipos hay)/.test(t)) return "cuantos_equipos";
    if (/(cuantos grupos|numero de grupos|total de grupos)/.test(t)) return "cuantos_grupos";
    if (/(cuantos (equipos |selecciones )?(clasifican|pasan|avanzan)|cuantos (van a|llegan a) eliminatorias)/.test(t)) return "cuantos_clasifican";
    if (/(ranking de|ranking fifa de|posicion fifa de|puesto de|en que puesto esta|que ranking tiene)/.test(t)) return "ver_ranking";
    if (/(quien tiene mejor ranking|quien esta mejor rankeado|quien es favorito entre|quien es mejor entre)/.test(t)) return "comparar_equipos";
    if (/(quien tiene el mejor ranking|cual es la mejor seleccion|quien esta primero|mejor seleccion del mundo)/.test(t)) return "mejor_ranking";
    if (/(top 10|los 10 mejores|mejores 10|top diez)/.test(t)) return "top_10_ranking";
    if (/(top 5|los 5 mejores|mejores 5|top cinco)/.test(t)) return "top_5_ranking";
    if (/(equipos de|selecciones de|quien clasifica de|cuales son los equipos de)/.test(t) && extraerConfederacion(t)) return "equipos_por_confederacion";
    if (/(confederacion de|confederacion|a que confederacion pertenece)/.test(t)) return "confederacion_equipo";
    if (/(grupo mas fuerte|grupo de la muerte|grupo dificil|grupo complicado)/.test(t)) return "grupo_mas_fuerte";
    if (/(grupo mas debil|grupo mas facil|grupo sencillo)/.test(t)) return "grupo_mas_debil";
    if (/(promedio de ranking|ranking promedio|ranking medio).*(grupo)/.test(t) || /(grupo).*promedio/.test(t)) return "promedio_ranking_grupo";
    if (/(quien es el favorito|favorito del grupo|mejor equipo del grupo|mas fuerte del grupo)/.test(t) && extraerGrupo(t)) return "favorito_grupo";
    if (/(quien ganara el mundial|quien es el favorito a ganar|quien tiene mas chances|quien va a ganar)/.test(t)) return "favorito_campeon";
    if (/(esta en el mundial|clasifica al mundial|fue al mundial|participa en el mundial|juega el mundial)/.test(t)) return "equipo_en_mundial";
    if (/(lista|dame|muestra|todos).*(equipos|selecciones)/.test(t) && !/(grupo|ranking)/.test(t)) return "listar_todos_equipos";
    if (/(cuales equipos|que equipos).*(mas puntos|mayor puntaje|mas puntos fifa)/.test(t)) return "equipos_mas_puntos";
    if (/(quienes clasificaron|quienes pasaron|equipos clasificados|clasificados a eliminatorias)/.test(t)) return "ver_clasificados";
    if (/(mejores terceros|cuales son los mejores terceros|quienes fueron los terceros)/.test(t)) return "ver_mejores_terceros";
    if (/(cuando es el mundial|cuando se juega|fechas del mundial|en que ano|cuando empieza|cuando comienza|cuando inicia|dia del mundial)/.test(t)) return "cuando_mundial";
    if (/(donde (es|sera|se juega)|sede|ciudad(es)?|estadio(s)?).*(mundial)/.test(t) ||
        /(mundial).*(donde|sede)/.test(t) ||
        /ciudades?\s*(sede|anfitriona|del mundial)/.test(t) ||
        /cuales son las ciudades/.test(t) ||
        /sedes del mundial/.test(t))
        return "sede_mundial";
    if (/(formato del mundial|como funciona|cuantas fases|como se juega el mundial|estructura del torneo)/.test(t)) return "formato_mundial";
    if (/(quien organiza|organizadores|organizacion del mundial)/.test(t)) return "organizador_mundial";
    if (/(ultimo campeon|quien gano el ultimo|campeon del mundo actual|quien es el campeon del mundo|quien fue campeon en el mundial)/.test(t)) return "conocimiento";
    if (/(subcampeon|quien fue el subcampeon)/.test(t)) return "conocimiento";
    if (/(goleador historico|goleador de todos|maximo goleador de la historia)/.test(t)) return "conocimiento";
    if (/(primer campeon|primero en ganar|primer mundial|cuando empezo el mundial)/.test(t)) return "conocimiento";
    if (/(estadio de la final|estadio final del mundial|donde es la final)/.test(t)) return "conocimiento";
    if (/(partidos totales|cuantos partidos|total de partidos)/.test(t)) return "conocimiento";
    if (/(quien gano la simulacion|campeon simulado|quien es el campeon simulado)/.test(t)) return "ver_campeon_simulado";
    if (/(cuantos puntos tiene|puntos fifa de|puntaje de)/.test(t)) return "ver_puntos";
    if (/(diferencia de puntos|cuantos puntos (le lleva|de diferencia)|diferencia entre)/.test(t)) return "diferencia_puntos";
    if (/(que puedes hacer|que sabes|ayuda|help|que preguntas|para que sirves|que eres)/.test(t)) return "ayuda";
    if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|saludos)$/.test(t)) return "saludo";

    return "desconocido";
}

async function extraerEquipo(pregunta) {
    const result = await pool.query("SELECT nombre FROM equipos ORDER BY LENGTH(nombre) DESC");
    const texto = normalizarTexto(pregunta);
    for (const row of result.rows) {
        if (texto.includes(normalizarTexto(row.nombre))) return row.nombre;
    }
    return null;
}

async function extraerEquiposMultiples(pregunta) {
    const result = await pool.query("SELECT nombre FROM equipos ORDER BY LENGTH(nombre) DESC");
    const texto = normalizarTexto(pregunta);
    const encontrados = [];
    for (const row of result.rows) {
        if (texto.includes(normalizarTexto(row.nombre))) encontrados.push(row.nombre);
    }
    return [...new Set(encontrados)].slice(0, 2);
}

async function obtenerEquipoPorNombre(nombre) {
    const result = await pool.query(
        "SELECT nombre, ranking_fifa, puntos_fifa, confederacion FROM equipos WHERE nombre = $1 LIMIT 1",
        [nombre]
    );
    return result.rows[0] || null;
}

async function buscarMemoriaSimilar(pregunta, intent) {
    const result = await pool.query(
        `SELECT pregunta, respuesta, similarity(pregunta, $1) AS similitud
         FROM consultas WHERE intent = $2 AND respuesta IS NOT NULL
         ORDER BY similarity(pregunta, $1) DESC LIMIT 1`,
        [pregunta, intent]
    );
    if (result.rows.length > 0 && Number(result.rows[0].similitud) >= 0.60) return result.rows[0].respuesta;
    return null;
}

async function buscarPatronMundial(pregunta) {
    const texto = normalizarTexto(pregunta);
    const result = await pool.query(
        `SELECT patron, intencion, clave_conocimiento, prioridad
         FROM patrones_mundial WHERE activo = TRUE ORDER BY prioridad DESC, id ASC`
    );
    for (const row of result.rows) {
        const patron = normalizarTexto(row.patron);
        try {
            const regex = new RegExp(patron, "i");
            if (regex.test(texto)) return row;
        } catch {
            if (texto.includes(patron)) return row;
        }
    }
    return null;
}

async function obtenerConocimientoPorClave(clave) {
    const result = await pool.query(
        `SELECT clave, pregunta_base, respuesta, datos, fuente FROM conocimiento_mundial WHERE clave = $1 LIMIT 1`,
        [clave]
    );
    return result.rows[0] || null;
}

async function buscarConocimientoUsuario(pregunta) {
    const textoNorm = normalizarTexto(pregunta);

    // 1. Similaridad trigrama — umbral alto para evitar falsos positivos
    const r1 = await pool.query(
        `SELECT clave, pregunta_base, respuesta,
                GREATEST(similarity(pregunta_base, $1), similarity(respuesta, $1)) AS sim
         FROM conocimiento_mundial WHERE fuente = 'usuario'
         ORDER BY GREATEST(similarity(pregunta_base, $1), similarity(respuesta, $1)) DESC LIMIT 3`,
        [textoNorm]
    );
    if (r1.rows.length > 0 && Number(r1.rows[0].sim) >= 0.55) return r1.rows[0];

    // 2. Busqueda por keywords — solo si hay 2+ palabras especificas (no genericas)
    const keywords = extraerKeywords(textoNorm);
    // Filtro adicional: descartar keywords que sean nombres de conceptos muy comunes
    const kwEspecificas = keywords.filter(w => w.length >= 5);
    if (kwEspecificas.length >= 2) {
        try {
            const conditions = kwEspecificas.slice(0, 3)
                .map((w, i) => `(pregunta_base ILIKE $${i + 2} OR respuesta ILIKE $${i + 2})`)
                .join(" AND ");
            const params = [textoNorm, ...kwEspecificas.slice(0, 3).map(w => `%${w}%`)];
            const r2 = await pool.query(
                `SELECT clave, pregunta_base, respuesta FROM conocimiento_mundial
                 WHERE fuente = 'usuario' AND (${conditions})
                 ORDER BY similarity(pregunta_base, $1) DESC LIMIT 1`,
                params
            );
            if (r2.rows.length > 0) return r2.rows[0];
        } catch { }
    }
    return null;
}

async function buscarConocimientoSimilar(pregunta) {
    const textoNorm = normalizarTexto(pregunta);
    const r1 = await pool.query(
        `SELECT clave, pregunta_base, respuesta,
                GREATEST(similarity(pregunta_base, $1), similarity(respuesta, $1)) AS sim
         FROM conocimiento_mundial
         ORDER BY GREATEST(similarity(pregunta_base, $1), similarity(respuesta, $1)) DESC LIMIT 3`,
        [textoNorm]
    );
    if (r1.rows.length > 0 && Number(r1.rows[0].sim) >= 0.50) return r1.rows[0];

    const keywords = extraerKeywords(textoNorm);
    const kwEspecificas = keywords.filter(w => w.length >= 5);
    if (kwEspecificas.length >= 2) {
        try {
            const conditions = kwEspecificas.slice(0, 3)
                .map((w, i) => `(pregunta_base ILIKE $${i + 2} OR respuesta ILIKE $${i + 2})`)
                .join(" AND ");
            const params = [textoNorm, ...kwEspecificas.slice(0, 3).map(w => `%${w}%`)];
            const r2 = await pool.query(
                `SELECT clave, pregunta_base, respuesta FROM conocimiento_mundial
                 WHERE (${conditions})
                 ORDER BY similarity(pregunta_base, $1) DESC LIMIT 1`,
                params
            );
            if (r2.rows.length > 0) return r2.rows[0];
        } catch { }
    }
    return null;
}

async function guardarConocimiento(clave, preguntaBase, respuesta, fuente = "usuario", datos = null) {
    await pool.query(
        `INSERT INTO conocimiento_mundial (clave, pregunta_base, respuesta, fuente, datos)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (clave) DO UPDATE SET
           pregunta_base = EXCLUDED.pregunta_base,
           respuesta = EXCLUDED.respuesta,
           fuente = EXCLUDED.fuente,
           datos = EXCLUDED.datos,
           fecha = CURRENT_TIMESTAMP`,
        [clave, preguntaBase, respuesta, fuente, datos ? JSON.stringify(datos) : null]
    );
}

async function obtenerAprendizajePendiente() {
    const result = await pool.query(
        `SELECT id, pregunta, entidades, fecha FROM consultas
         WHERE intent = 'aprendizaje_pendiente' ORDER BY id DESC LIMIT 1`
    );
    return result.rows[0] || null;
}

async function obtenerSimulacionActual() {
    const result = await pool.query("SELECT datos FROM simulacion_grupos_actual ORDER BY id DESC LIMIT 1");
    return result.rows.length > 0 ? result.rows[0].datos : null;
}

function detectarPreguntaAmbigua(texto) {
    const t = normalizarTexto(texto);
    for (const tema of TEMAS_AMBIGUOS) {
        if (tema.test.test(t)) return tema;
    }
    return null;
}

function resolverSeguimiento(pregunta) {
    if (!ctxActivo) return null;
    const EXPIRA_MS = 3 * 60 * 1000; // 3 minutos
    if (Date.now() - ctxActivo.timestamp > EXPIRA_MS) { ctxActivo = null; return null; }
    const t = normalizarTexto(pregunta);
    for (const opcion of ctxActivo.opciones) {
        if (opcion.test.test(t)) {
            // Mantener contexto activo para follow-ups encadenados ("y del 2026", "y de 2022?")
            ctxActivo = { ...ctxActivo, timestamp: Date.now() };
            return opcion.respuesta();
        }
    }
    // Frases muy cortas (1-3 palabras) sin match → posiblemente intento de seguimiento no reconocido
    // No destruir el contexto, dejar que siga activo
    if (t.split(" ").length <= 3) return null;
    // Frase larga sin match → nueva pregunta, limpiar contexto
    ctxActivo = null;
    return null;
}

function respuestaFueraDeDominio(pregunta = "") {
    const t = normalizarTexto(pregunta);
    if (/mundial|copa|seleccion|equipo|jugador|futbol/.test(t)) {
        return (
            "No tengo ese dato especifico. Puedes ensenarmelo:\n" +
            "   aprende que [concepto] es [informacion]\n\n" +
            "O preguntame sobre grupos, ranking, simulaciones o historia del Mundial 2026."
        );
    }
    if (/quien es|que hizo|cuantos goles|donde juega|cuando nacio/.test(t)) {
        return (
            "No tengo informacion sobre eso. Si quieres guardarlo:\n" +
            "   aprende que [la respuesta a tu pregunta]\n\n" +
            "Estoy especializado en el Mundial 2026."
        );
    }
    return (
        "Estoy especializado en el Mundial 2026. Puedo ayudarte con:\n" +
        "- Grupos, equipos y rankings FIFA\n" +
        "- Simulaciones de partidos y fase de grupos\n" +
        "- Historia del torneo y estadisticas\n" +
        "- Clasificados y eliminatorias\n\n" +
        "Si me falta un dato, puedes ensenarme:\n" +
        "   aprende que [dato nuevo]"
    );
}

function formatearRespuestaConocimiento(conocimiento) {
    const formatos = {
        ultimo_campeon_mundo: `El ultimo campeon del mundo es ${conocimiento.respuesta}.`,
        subcampeon_mundo: `El subcampeon del ultimo Mundial es ${conocimiento.respuesta}.`,
        sede_mundial_2026: conocimiento.respuesta,
        fecha_mundial_2026: conocimiento.respuesta,
        goleador_historico_mundial: conocimiento.respuesta,
        primer_campeon_mundial: conocimiento.respuesta,
        estadio_final_mundial: conocimiento.respuesta,
        partidos_totales_mundial: conocimiento.respuesta,
    };
    if (formatos[conocimiento.clave]) return formatos[conocimiento.clave];

    const r = (conocimiento.respuesta || "").trim();
    if (!r) return "Tengo ese dato guardado pero vacio. Actualizalo con: aprende que [dato]";

    const matchEs = r.match(/^(.+?)\s+(es|fue|sera|son|fueron|tiene|tuvo|gano|perdio|jugo|juega)\s+(.+)$/i);
    if (matchEs) {
        const concepto = matchEs[1];
        const verbo = matchEs[2];
        const valor = matchEs[3];
        const conceptoCap = concepto.charAt(0).toUpperCase() + concepto.slice(1);
        const valorCap = valor.charAt(0).toUpperCase() + valor.slice(1);
        return `${conceptoCap} ${verbo} ${valorCap}.`;
    }

    return r.charAt(0).toUpperCase() + r.slice(1) + (r.endsWith(".") ? "" : ".");
}

function calcularRankingPromedioGrupo(equiposGrupo) {
    const rankings = equiposGrupo.filter(e => e.ranking && e.ranking < 900).map(e => e.ranking);
    if (rankings.length === 0) return 999;
    return Math.round(rankings.reduce((a, b) => a + b, 0) / rankings.length);
}

app.post("/chat", async (req, res) => {
    try {
        const { pregunta } = req.body;
        if (!pregunta) return res.status(400).json({ error: "Debes enviar { pregunta }" });

        const grupos = await obtenerEquiposPorGrupo();
        const grupo = extraerGrupo(pregunta);
        const gruposMultiples = extraerGruposMultiples(pregunta);
        const grupoExcluido = extraerGrupoExcluido(pregunta);
        const equipo = await extraerEquipo(pregunta);
        const equiposComparacion = await extraerEquiposMultiples(pregunta);
        const confederacion = extraerConfederacion(pregunta);

        let intent = detectarIntent(pregunta);
        const entidades = { grupo, gruposMultiples, grupoExcluido, equipo, equiposComparacion, confederacion, clave_conocimiento: null };
        let respuesta = "__pendiente__";
        let simulData = null;

        // BLOQUE 0: ENSEÑANZA EXPLICITA
        if (intent === "ensenar_conocimiento") {
            const contenido = limpiarEnsenanza(pregunta);
            if (contenido.length > 3) {
                const matchEs = contenido.match(/^(.+?)\s+(es|fue|sera|son|fueron|tiene|tuvo|gano|perdio|jugo|juega)\s+(.+)$/i);
                const conceptoBase = matchEs ? matchEs[1].trim() : contenido.split(" ").slice(0, 6).join(" ");
                const clave = generarClaveConocimiento(conceptoBase);
                const preguntaBase = matchEs ? `cual es ${normalizarTexto(conceptoBase)}` : normalizarTexto(contenido);
                await guardarConocimiento(clave, preguntaBase, contenido, "usuario");

                const patronAuto = normalizarTexto(conceptoBase);
                if (patronAuto.length > 5) {
                    await pool.query(
                        `INSERT INTO patrones_mundial (patron, intencion, clave_conocimiento, prioridad)
                         VALUES ($1, 'conocimiento', $2, 3) ON CONFLICT DO NOTHING`,
                        [patronAuto, clave]
                    );
                    await pool.query(
                        `UPDATE patrones_mundial SET clave_conocimiento = $1 WHERE patron = $2`,
                        [clave, patronAuto]
                    );
                }

                const variantes = [
                    `quien (es|fue|sera) ${patronAuto}`,
                    `que (es|fue) ${patronAuto}`,
                    `cual es ${patronAuto}`,
                    `dime ${patronAuto}`,
                ];
                for (const variante of variantes) {
                    if (variante.length > 8) {
                        await pool.query(
                            `INSERT INTO patrones_mundial (patron, intencion, clave_conocimiento, prioridad)
                             VALUES ($1, 'conocimiento', $2, 2) ON CONFLICT DO NOTHING`,
                            [variante, clave]
                        );
                    }
                }

                const valorGuardado = matchEs ? matchEs[3] : contenido;
                respuesta = `Listo, aprendi que "${conceptoBase}" = "${valorGuardado}".\nCuando me preguntes sobre "${conceptoBase}", te dare esa informacion.`;
                intent = "aprendizaje_confirmado";
            } else {
                respuesta = "No entendi bien. Ejemplo: aprende que la mascota del Mundial se llama Taino";
            }
            await pool.query(
                "INSERT INTO consultas (pregunta, respuesta, intent, entidades) VALUES ($1, $2, $3, $4)",
                [pregunta, respuesta, intent, JSON.stringify(entidades)]
            );
            return res.json({ respuesta, intent, simulData });
        }

        // BLOQUE 1: RESOLVER SEGUIMIENTO DE DIALOGO
        const seguimientoResp = resolverSeguimiento(pregunta);
        if (seguimientoResp) {
            respuesta = seguimientoResp;
            intent = "dialogo_seguimiento";
            await pool.query(
                "INSERT INTO consultas (pregunta, respuesta, intent, entidades) VALUES ($1, $2, $3, $4)",
                [pregunta, respuesta, intent, JSON.stringify(entidades)]
            );
            return res.json({ respuesta, intent, simulData });
        }

        // BLOQUE 2: CONOCIMIENTO DEL USUARIO
        const conocimientoUsuario = await buscarConocimientoUsuario(pregunta);
        if (conocimientoUsuario) {
            respuesta = formatearRespuestaConocimiento(conocimientoUsuario);
            await pool.query(
                "INSERT INTO consultas (pregunta, respuesta, intent, entidades) VALUES ($1, $2, $3, $4)",
                [pregunta, respuesta, "conocimiento_usuario", JSON.stringify(entidades)]
            );
            return res.json({ respuesta, intent: "conocimiento_usuario", simulData });
        }

        // BLOQUE 3: PATRON MUNDIAL
        const patron = await buscarPatronMundial(pregunta);
        if (patron?.intencion && (intent === "desconocido" || patron.intencion === "conocimiento")) {
            intent = patron.intencion;
            entidades.clave_conocimiento = patron.clave_conocimiento || null;
        }

        // BLOQUE 4: APRENDIZAJE PENDIENTE
        const pendiente = await obtenerAprendizajePendiente();
        if (pendiente && pendiente.entidades?.clave_conocimiento) {
            const t = normalizarTexto(pregunta);
            const bloqueadas = ["simula", "grupo", "grupos", "ranking", "clasificados", "campeon", "mundial", "cuando", "donde", "aprende"];
            const esProbableRespuesta = t.length > 0 && t.length < 120 && !bloqueadas.some(x => t.includes(x));
            if (esProbableRespuesta) {
                const clave = pendiente.entidades.clave_conocimiento;
                await guardarConocimiento(clave, normalizarTexto(pendiente.pregunta), pregunta.trim(), "usuario");
                respuesta = "Perfecto, guardado. La proxima vez que preguntes lo mismo, te dare esa respuesta.";
                intent = "aprendizaje_confirmado";
                await pool.query(
                    "INSERT INTO consultas (pregunta, respuesta, intent, entidades) VALUES ($1, $2, $3, $4)",
                    [pregunta, respuesta, intent, JSON.stringify({ aprendio_clave: clave })]
                );
                return res.json({ respuesta, intent, simulData });
            }
        }

        // BLOQUE 5: CONOCIMIENTO SISTEMA
        if (patron?.intencion === "conocimiento" && patron?.clave_conocimiento) {
            const conocimiento = await obtenerConocimientoPorClave(patron.clave_conocimiento);
            if (conocimiento) {
                respuesta = formatearRespuestaConocimiento(conocimiento);
                intent = "conocimiento";
            } else {
                respuesta = `No tengo ese dato aun. Si lo sabes:\n   aprende que [la respuesta]`;
                intent = "aprendizaje_pendiente";
                entidades.clave_conocimiento = patron.clave_conocimiento;
            }
        }

        // BLOQUE 6: INTENTS ESPECIFICOS
        if (respuesta === "__pendiente__") {

            if (intent === "saludo") {
                respuesta = "Hola. Soy la IA del Mundial 2026.\nPuedes preguntarme sobre grupos, equipos, rankings, simulaciones y mucho mas. En que te ayudo?";
            }
            else if (intent === "ayuda") {
                respuesta = "Puedo responder sobre:\n\nGrupos: Que equipos estan en el Grupo A?\nRanking: En que ranking esta Brasil?\nPartido: Quien le gana a Francia vs Argentina?\nSimular: Simula la fase de grupos\nHistoria: Quien fue el goleador historico del Mundial?\nFavorito: Quien ganara el Mundial 2026?\n\nTambien puedes ensenarme datos nuevos:\n   aprende que [dato del mundial]";
            }
            else if (intent === "ver_grupos") {
                const memoria = await buscarMemoriaSimilar(pregunta, intent);
                if (memoria) { respuesta = memoria; }
                else {
                    const lista = Object.keys(grupos).sort().map(g => `Grupo ${g}:\n- ${grupos[g].map(e => e.nombre).join("\n- ")}`).join("\n\n");
                    respuesta = `Estos son los 12 grupos del Mundial 2026:\n\n${lista}`;
                }
            }
            else if (intent === "ver_grupos_excluyendo" && grupoExcluido) {
                const lista = Object.keys(grupos).sort().filter(g => g !== grupoExcluido)
                    .map(g => `Grupo ${g}:\n- ${grupos[g].map(e => e.nombre).join("\n- ")}`).join("\n\n");
                respuesta = `Todos los grupos excepto el Grupo ${grupoExcluido}:\n\n${lista}`;
            }
            else if (intent === "ver_grupos_multiples" && gruposMultiples.length > 0) {
                const validos = gruposMultiples.filter(g => grupos[g]);
                if (validos.length > 0) respuesta = validos.sort().map(g => `Grupo ${g}:\n- ${grupos[g].map(e => e.nombre).join("\n- ")}`).join("\n\n");
                else respuesta = "No encontre los grupos solicitados.";
            }
            else if (intent === "ver_grupo" && grupo) {
                if (grupos[grupo]) {
                    const lista = grupos[grupo].map((e, i) => `${i + 1}. ${e.nombre} (Ranking FIFA: #${e.ranking})`).join("\n");
                    respuesta = `Equipos del Grupo ${grupo}:\n\n${lista}`;
                } else respuesta = `No encontre informacion para el Grupo ${grupo}.`;
            }
            else if (intent === "cuantos_equipos") {
                const r = await pool.query("SELECT COUNT(*) FROM equipos WHERE nombre NOT LIKE '%UEFA%' AND nombre NOT LIKE '%REPECHAJE%'");
                respuesta = `El Mundial 2026 cuenta con ${r.rows[0].count} selecciones participantes, distribuidas en 12 grupos de 4 equipos cada uno.`;
            }
            else if (intent === "cuantos_grupos") { respuesta = "El Mundial 2026 tiene 12 grupos (del A al L), con 4 equipos cada uno. En total participan 48 selecciones."; }
            else if (intent === "cuantos_clasifican") { respuesta = "De cada grupo clasifican los 2 primeros.\nAdemas, los 8 mejores terceros tambien avanzan.\n\nTotal: 56 equipos pasan a dieciseisavos de final."; }
            else if (intent === "ver_ranking" && equipo) {
                const r = await pool.query("SELECT nombre, ranking_fifa, puntos_fifa, confederacion FROM equipos WHERE nombre = $1", [equipo]);
                if (r.rows.length > 0) { const e = r.rows[0]; respuesta = `Ranking FIFA de ${e.nombre}:\n- Posicion: #${e.ranking_fifa}\n- Puntos FIFA: ${e.puntos_fifa}\n- Confederacion: ${e.confederacion}`; }
                else respuesta = `No encontre el ranking de "${equipo}".`;
            }
            else if (intent === "ver_ranking" && !equipo) { respuesta = "De que equipo quieres ver el ranking? Ejemplo: En que ranking esta Brasil?"; }
            else if (intent === "ver_puntos" && equipo) {
                const r = await pool.query("SELECT nombre, puntos_fifa, ranking_fifa FROM equipos WHERE nombre = $1", [equipo]);
                if (r.rows.length > 0) { const e = r.rows[0]; respuesta = `${e.nombre} tiene ${e.puntos_fifa} puntos FIFA (puesto #${e.ranking_fifa}).`; }
                else respuesta = `No encontre los puntos de "${equipo}".`;
            }
            else if (intent === "diferencia_puntos" && equiposComparacion.length >= 2) {
                const [nA, nB] = equiposComparacion;
                const eA = await obtenerEquipoPorNombre(nA); const eB = await obtenerEquipoPorNombre(nB);
                if (eA && eB) { const diff = Math.abs(eA.puntos_fifa - eB.puntos_fifa); const mejor = eA.puntos_fifa > eB.puntos_fifa ? eA : eB; respuesta = `Diferencia de puntos FIFA entre ${nA} (${eA.puntos_fifa} pts) y ${nB} (${eB.puntos_fifa} pts): ${diff} puntos.\n${mejor.nombre} esta por encima.`; }
                else respuesta = "No pude encontrar los datos de ambos equipos.";
            }
            else if (intent === "comparar_equipos" && equiposComparacion.length >= 2) {
                const [nA, nB] = equiposComparacion;
                const eA = await obtenerEquipoPorNombre(nA); const eB = await obtenerEquipoPorNombre(nB);
                if (eA && eB) { const mejor = Number(eA.ranking_fifa) < Number(eB.ranking_fifa) ? eA : eB; respuesta = `Comparacion FIFA:\n\n- ${eA.nombre}: Ranking #${eA.ranking_fifa} | ${eA.puntos_fifa} pts\n- ${eB.nombre}: Ranking #${eB.ranking_fifa} | ${eB.puntos_fifa} pts\n\n${mejor.nombre} esta mejor posicionado por ${Math.abs(Number(eA.ranking_fifa) - Number(eB.ranking_fifa))} puestos.`; }
                else respuesta = "No pude comparar esos equipos.";
            }
            else if (intent === "mejor_ranking") {
                const r = await pool.query("SELECT nombre, ranking_fifa, puntos_fifa FROM equipos WHERE ranking_fifa IS NOT NULL AND ranking_fifa < 900 ORDER BY ranking_fifa ASC LIMIT 1");
                if (r.rows.length > 0) { const e = r.rows[0]; respuesta = `La seleccion con mejor ranking FIFA en el Mundial 2026 es ${e.nombre}, posicion #${e.ranking_fifa} con ${e.puntos_fifa} puntos.`; }
                else respuesta = "No encontre datos de ranking FIFA.";
            }
            else if (intent === "top_10_ranking") {
                const r = await pool.query("SELECT nombre, ranking_fifa, puntos_fifa FROM equipos WHERE ranking_fifa < 900 ORDER BY ranking_fifa ASC LIMIT 10");
                respuesta = `Top 10 del ranking FIFA en el Mundial 2026:\n\n${r.rows.map((e, i) => `${i + 1}. ${e.nombre} - #${e.ranking_fifa} (${e.puntos_fifa} pts)`).join("\n")}`;
            }
            else if (intent === "top_5_ranking") {
                const r = await pool.query("SELECT nombre, ranking_fifa, puntos_fifa FROM equipos WHERE ranking_fifa < 900 ORDER BY ranking_fifa ASC LIMIT 5");
                respuesta = `Top 5 del ranking FIFA en el Mundial 2026:\n\n${r.rows.map((e, i) => `${i + 1}. ${e.nombre} - #${e.ranking_fifa} (${e.puntos_fifa} pts)`).join("\n")}`;
            }
            else if (intent === "equipos_mas_puntos") {
                const r = await pool.query("SELECT nombre, puntos_fifa, ranking_fifa FROM equipos WHERE puntos_fifa > 0 ORDER BY puntos_fifa DESC LIMIT 10");
                respuesta = `Equipos con mas puntos FIFA en el Mundial 2026:\n\n${r.rows.map((e, i) => `${i + 1}. ${e.nombre} - ${e.puntos_fifa} pts (Rank #${e.ranking_fifa})`).join("\n")}`;
            }
            else if (intent === "confederacion_equipo" && equipo) {
                const e = await obtenerEquipoPorNombre(equipo);
                if (e) respuesta = `${e.nombre} pertenece a la confederacion ${e.confederacion}.`;
                else respuesta = `No encontre la confederacion de "${equipo}".`;
            }
            else if (intent === "equipos_por_confederacion" && confederacion) {
                const r = await pool.query("SELECT nombre, ranking_fifa FROM equipos WHERE confederacion = $1 AND ranking_fifa < 900 ORDER BY ranking_fifa ASC", [confederacion]);
                if (r.rows.length > 0) respuesta = `Equipos de ${confederacion} en el Mundial 2026 (${r.rows.length}):\n\n${r.rows.map(e => `- ${e.nombre} (Ranking #${e.ranking_fifa})`).join("\n")}`;
                else respuesta = `No encontre equipos de ${confederacion}.`;
            }
            else if (intent === "grupo_de_equipo" && equipo) {
                const r = await pool.query(`SELECT g.nombre AS grupo FROM grupo_equipos ge JOIN equipos e ON ge.equipo_id = e.id JOIN grupos g ON ge.grupo_id = g.id WHERE e.nombre = $1 LIMIT 1`, [equipo]);
                if (r.rows.length > 0) { const grupoEquipo = r.rows[0].grupo; const comp = (grupos[grupoEquipo] || []).filter(e => e.nombre !== equipo).map(e => e.nombre); respuesta = `${equipo} esta en el Grupo ${grupoEquipo}.\nSus rivales: ${comp.join(", ")}.`; }
                else respuesta = `No encontre el grupo de "${equipo}".`;
            }
            else if (intent === "grupo_de_equipo" && !equipo) { respuesta = "De que equipo quieres saber el grupo? Ejemplo: En que grupo esta Brasil?"; }
            else if (intent === "equipo_en_mundial" && equipo) {
                const r = await pool.query(`SELECT e.nombre FROM equipos e JOIN grupo_equipos ge ON e.id = ge.equipo_id WHERE e.nombre = $1 LIMIT 1`, [equipo]);
                respuesta = r.rows.length > 0 ? `Si, ${equipo} esta clasificado al Mundial 2026.` : `${equipo} no aparece en la lista del Mundial 2026.`;
            }
            else if (intent === "equipo_en_mundial" && !equipo) { respuesta = "De que seleccion quieres saber si esta en el Mundial?"; }
            else if (intent === "listar_todos_equipos") {
                const r = await pool.query("SELECT nombre, confederacion, ranking_fifa FROM equipos WHERE ranking_fifa < 900 ORDER BY ranking_fifa ASC");
                respuesta = `Todas las selecciones del Mundial 2026 (${r.rows.length} equipos):\n\n${r.rows.map(e => `- ${e.nombre} (${e.confederacion}, #${e.ranking_fifa})`).join("\n")}`;
            }
            else if (intent === "grupo_mas_fuerte") {
                let mejorGrupo = null, menorPromedio = 999;
                for (const g of Object.keys(grupos)) { const prom = calcularRankingPromedioGrupo(grupos[g]); if (prom < menorPromedio) { menorPromedio = prom; mejorGrupo = g; } }
                if (mejorGrupo) { const lista = grupos[mejorGrupo].map(e => `${e.nombre} (#${e.ranking})`).join(", "); respuesta = `El Grupo ${mejorGrupo} es el grupo mas fuerte (ranking promedio: #${menorPromedio}).\nEquipos: ${lista}`; }
                else respuesta = "No pude calcular el grupo mas fuerte.";
            }
            else if (intent === "grupo_mas_debil") {
                let grupoDebil = null, mayorPromedio = 0;
                for (const g of Object.keys(grupos)) { const prom = calcularRankingPromedioGrupo(grupos[g]); if (prom > mayorPromedio) { mayorPromedio = prom; grupoDebil = g; } }
                if (grupoDebil) { const lista = grupos[grupoDebil].map(e => `${e.nombre} (#${e.ranking})`).join(", "); respuesta = `El Grupo ${grupoDebil} es el mas accesible (ranking promedio: #${mayorPromedio}).\nEquipos: ${lista}`; }
                else respuesta = "No pude calcular el grupo mas debil.";
            }
            else if (intent === "promedio_ranking_grupo" && grupo) {
                if (grupos[grupo]) { const prom = calcularRankingPromedioGrupo(grupos[grupo]); const lista = grupos[grupo].map(e => `${e.nombre} (#${e.ranking})`).join(", "); respuesta = `Grupo ${grupo} - ranking promedio: #${prom}.\nEquipos: ${lista}`; }
                else respuesta = `No encontre el Grupo ${grupo}.`;
            }
            else if (intent === "favorito_grupo" && grupo) {
                if (grupos[grupo]) { const favorito = [...grupos[grupo]].filter(e => e.ranking < 900).sort((a, b) => a.ranking - b.ranking)[0]; respuesta = `El favorito del Grupo ${grupo} es ${favorito.nombre} (Ranking #${favorito.ranking}).`; }
                else respuesta = `No encontre el Grupo ${grupo}.`;
            }
            else if (intent === "favorito_campeon") {
                const r = await pool.query("SELECT nombre, ranking_fifa, puntos_fifa FROM equipos WHERE ranking_fifa < 900 ORDER BY ranking_fifa ASC LIMIT 5");
                if (r.rows.length > 0) { const lista = r.rows.map((e, i) => `${i + 1}. ${e.nombre} (#${e.ranking_fifa})`).join("\n"); respuesta = `Favorito segun ranking FIFA: ${r.rows[0].nombre}.\n\nTop 5 candidatos:\n${lista}\n\nEn el futbol siempre hay sorpresas.`; }
                else respuesta = "No encontre datos para calcular el favorito.";
            }
            else if (intent === "simular_partido" && equiposComparacion.length >= 2) {
                const [nA, nB] = equiposComparacion;
                const eA = await obtenerEquipoPorNombre(nA); const eB = await obtenerEquipoPorNombre(nB);
                if (eA && eB) {
                    const rankA = Number(eA.ranking_fifa) || 999; const rankB = Number(eB.ranking_fifa) || 999;
                    let probA = (1 / rankA) / (1 / rankA + 1 / rankB);
                    const diff = rankB - rankA;
                    probA += diff > 0 ? Math.min(diff * 0.004, 0.25) : Math.max(diff * 0.004, -0.25);
                    probA = Math.max(0.05, Math.min(0.95, probA));
                    const ganaA = Math.random() < probA;
                    const golesG = Math.floor(Math.random() * 3) + 1; const golesP = Math.floor(Math.random() * golesG);
                    const [gA, gB] = ganaA ? [golesG, golesP] : [golesP, golesG];
                    respuesta = `Simulacion:\n\n${nA} ${gA} - ${gB} ${nB}\n\nGanador: ${ganaA ? nA : nB}\nBasado en ranking FIFA. Cada simulacion puede variar.`;
                } else respuesta = "Para simular necesito dos equipos. Ejemplo: Quien gana entre Espana y Brasil?";
            }
            else if (intent === "simular_partido") { respuesta = "Para simular un partido necesito dos equipos. Ejemplo: Quien le gana a Argentina vs Francia?"; }
            else if (intent === "simular_grupos" && gruposMultiples.length > 0) {
                const { resultadosPorGrupo } = simularGruposSeleccionados(grupos, gruposMultiples);
                const gruposKeys = Object.keys(resultadosPorGrupo).sort();
                respuesta = `Simulacion de Grupo${gruposKeys.length > 1 ? "s" : ""} ${gruposKeys.join(", ")} completada.`;
                simulData = { tipo: "grupos", grupos: gruposKeys.map(g => ({ grupo: g, partidos: resultadosPorGrupo[g].partidos, tabla: resultadosPorGrupo[g].tabla, clasificados: resultadosPorGrupo[g].clasificados })) };
            }
            else if (intent === "simular_mundial") {
                const { resultadosPorGrupo, clasificados, mejoresTerceros } = simularFaseDeGrupos(grupos);
                respuesta = "Simulacion completa de la fase de grupos finalizada.";
                simulData = { tipo: "mundial", grupos: Object.keys(resultadosPorGrupo).sort().map(g => ({ grupo: g, partidos: resultadosPorGrupo[g].partidos, tabla: resultadosPorGrupo[g].tabla, clasificados: resultadosPorGrupo[g].clasificados })), clasificados: [...clasificados].sort((a, b) => a.posicion !== b.posicion ? a.posicion - b.posicion : a.grupo.localeCompare(b.grupo)), mejoresTerceros };
                await pool.query("DELETE FROM simulacion_grupos_actual");
                await pool.query("INSERT INTO simulacion_grupos_actual (datos) VALUES ($1)", [JSON.stringify({ resultadosPorGrupo, clasificados, mejoresTerceros })]);
            }
            else if (intent === "ver_clasificados") {
                const datos = await obtenerSimulacionActual();
                if (!datos) respuesta = "Aun no hay simulacion guardada. Usa: Simula la fase de grupos.";
                else { const texto = datos.clasificados.sort((a, b) => a.posicion !== b.posicion ? a.posicion - b.posicion : a.grupo.localeCompare(b.grupo)).map(c => `Grupo ${c.grupo} (${c.posicion}): ${c.nombre}`).join("\n"); respuesta = `Clasificados a eliminatorias:\n\n${texto}`; }
            }
            else if (intent === "ver_mejores_terceros") {
                const datos = await obtenerSimulacionActual();
                if (!datos?.mejoresTerceros) respuesta = "No hay simulacion. Primero simula la fase de grupos.";
                else { const texto = datos.mejoresTerceros.map(c => `Grupo ${c.grupo}: ${c.nombre} | Pts:${c.puntos} DG:${c.dg} GF:${c.gf}`).join("\n"); respuesta = `8 mejores terceros:\n\n${texto}`; }
            }
            else if (intent === "cuando_mundial") { respuesta = "El Mundial 2026 se celebrara del 11 de junio al 19 de julio de 2026."; }
            else if (intent === "sede_mundial") {
                respuesta =
                    "El Mundial 2026 se jugara en 16 ciudades sede:\n\n" +
                    "Estados Unidos (11): Nueva York/NJ, Los Angeles, Dallas, Miami, San Francisco, Seattle, Houston, Kansas City, Boston, Philadelphia, Atlanta\n\n" +
                    "Mexico (3): Ciudad de Mexico, Guadalajara, Monterrey\n\n" +
                    "Canada (2): Toronto, Vancouver\n\n" +
                    "La final sera en el MetLife Stadium (Nueva York/NJ).";
            }
            else if (intent === "organizador_mundial") { respuesta = "El Mundial 2026 es organizado por FIFA, con EE.UU. (11 ciudades), Mexico (3) y Canada (2) como co-sedes."; }
            else if (intent === "formato_mundial") { respuesta = "Formato del Mundial 2026:\n\n- 48 equipos en 12 grupos de 4\n- Clasifican: 2 primeros de cada grupo + 8 mejores terceros\n- Fases: 16avos, Octavos, Cuartos, Semis, Final\n- Fechas: 11 junio - 19 julio 2026\n- Sede: EE.UU., Mexico y Canada"; }
            else if (intent === "ver_campeon_simulado") { respuesta = "El campeon simulado se decide en la vista de eliminatorias. Pulsa Simular eliminatorias y ejecuta todas las rondas."; }
            else if (intent === "conocimiento") {
                const conocido = await buscarConocimientoSimilar(pregunta);
                if (conocido) { respuesta = formatearRespuestaConocimiento(conocido); intent = "conocimiento"; }
                else { respuesta = `No tengo ese dato. Si lo conoces:\n   aprende que [respuesta]`; intent = "aprendizaje_pendiente"; }
            }
            else {
                // BLOQUE 7: PREGUNTA AMBIGUA o FALLBACK
                const tema = detectarPreguntaAmbigua(normalizarTexto(pregunta));
                if (tema) {
                    ctxActivo = { tipo: "ambiguo", preguntaOriginal: pregunta, opciones: tema.opciones, timestamp: Date.now() };
                    respuesta = tema.clarificacion;
                    intent = "dialogo_clarificacion";
                } else {
                    const conocido = await buscarConocimientoSimilar(pregunta);
                    if (conocido) { respuesta = formatearRespuestaConocimiento(conocido); intent = "conocimiento_aprendido"; }
                    else { respuesta = respuestaFueraDeDominio(pregunta); intent = "fuera_de_dominio"; }
                }
            }
        }

        await pool.query(
            "INSERT INTO consultas (pregunta, respuesta, intent, entidades) VALUES ($1, $2, $3, $4)",
            [pregunta, respuesta, intent, JSON.stringify(entidades)]
        );
        res.json({ respuesta, intent, simulData });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

app.get("/api/clasificados", async (req, res) => {
    try {
        const result = await pool.query("SELECT datos FROM simulacion_grupos_actual ORDER BY id DESC LIMIT 1");
        if (result.rows.length === 0) return res.status(404).json({ error: "No hay simulacion guardada" });
        const datos = result.rows[0].datos;
        const clasificadosOrdenados = datos.clasificados.sort((a, b) => a.posicion !== b.posicion ? a.posicion - b.posicion : a.grupo.localeCompare(b.grupo)).map(c => ({ grupo: c.grupo, posicion: c.posicion, nombre: c.nombre, ranking: c.ranking, puntos: c.puntos, dg: c.dg, gf: c.gf }));
        res.json({ clasificados: clasificadosOrdenados });
    } catch (error) { console.error(error); res.status(500).json({ error: "Error al obtener clasificados" }); }
});

app.get("/api/eliminatorias/16vos", async (req, res) => {
    try {
        const result = await pool.query("SELECT datos FROM simulacion_grupos_actual ORDER BY id DESC LIMIT 1");
        if (result.rows.length === 0) return res.status(404).json({ error: "No hay simulacion guardada" });
        const datos = result.rows[0].datos;
        const cruces = generarCrucesDieciseisavos(datos.clasificados);
        res.json({ cruces });
    } catch (error) { console.error(error); res.status(500).json({ error: "Error al generar los 16vos" }); }
});

app.get("/api/conocimiento", async (req, res) => {
    try {
        const result = await pool.query("SELECT clave, pregunta_base, respuesta, fuente, fecha FROM conocimiento_mundial ORDER BY fecha DESC");
        res.json({ conocimiento: result.rows });
    } catch (error) { res.status(500).json({ error: "Error al obtener conocimiento" }); }
});

app.get("/api/estadisticas", async (req, res) => {
    try {
        const total = await pool.query("SELECT COUNT(*) FROM consultas");
        const porIntent = await pool.query("SELECT intent, COUNT(*) as total FROM consultas WHERE intent IS NOT NULL GROUP BY intent ORDER BY total DESC LIMIT 10");
        const sinResponder = await pool.query("SELECT COUNT(*) FROM consultas WHERE intent IN ('fuera_de_dominio', 'desconocido')");
        res.json({ total_consultas: total.rows[0].count, top_intents: porIntent.rows, sin_responder: sinResponder.rows[0].count });
    } catch (error) { res.status(500).json({ error: "Error al obtener estadisticas" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor IA Mundial 2026 en http://localhost:${PORT}`));