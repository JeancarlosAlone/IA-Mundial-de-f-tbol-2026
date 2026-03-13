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

function normalizarTexto(texto = "") {
    return texto
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[¿?¡!.,;:()"']/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function esEnsenanzaExplicita(texto = "") {
    const t = normalizarTexto(texto);
    return (
        t.startsWith("aprende que ") ||
        t.startsWith("guarda que ") ||
        t.startsWith("te digo que ") ||
        t.startsWith("anota que ") ||
        t.startsWith("recuerda que ") ||
        t.startsWith("sabe que ")
    );
}

function limpiarEnsenanza(texto = "") {
    const t = normalizarTexto(texto);
    return t
        .replace(/^aprende que\s+/, "")
        .replace(/^guarda que\s+/, "")
        .replace(/^te digo que\s+/, "")
        .replace(/^anota que\s+/, "")
        .replace(/^recuerda que\s+/, "")
        .replace(/^sabe que\s+/, "")
        .trim();
}

function generarClaveConocimiento(texto = "") {
    return normalizarTexto(texto)
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, "_")
        .substring(0, 100)
        .trim();
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
        if (letras) letras.forEach((l) => grupos.add(l));
    }
    if (grupos.size === 0 && /\b(SIMULA(R)?|PREDICE)\b/.test(texto)) {
        const letrasSueltas = texto.match(/\b[A-L]\b/g);
        if (letrasSueltas) letrasSueltas.forEach((l) => grupos.add(l));
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

    if (/(simular|simula|predice)/.test(t) && extraerGruposMultiples(t).length >= 1)
        return "simular_grupos";

    if (/(simular|simula|predice|genera|haz)/.test(t) &&
        /(fase de grupos|todos los grupos|clasificados|clasifica|mundial completo)/.test(t))
        return "simular_mundial";

    if (/(quien ganaria|quien le gana|quien gana|simulame|simula|enfrentamiento|partido entre|versus|vs)/.test(t) &&
        !/(ranking|grupo|mundial|clasificados)/.test(t))
        return "simular_partido";

    if (/(en que grupo esta|en que grupo juega|a que grupo pertenece|que grupo tiene|grupo de)/.test(t))
        return "grupo_de_equipo";

    if (/(dame|mostrar|muestrame|ver|cuales|que equipos)/.test(t) &&
        /grupos?/.test(t) && extraerGruposMultiples(t).length >= 2)
        return "ver_grupos_multiples";

    if (/(dame|mostrar|muestrame|ver|lista|cuales)/.test(t) &&
        /grupos/.test(t) && /menos/.test(t) && /\bgrupo\s+[a-l]\b/i.test(t))
        return "ver_grupos_excluyendo";

    if (/\bgrupo\s+[a-l]\b/i.test(t) &&
        /(dame|mostrar|muestrame|ver|cuales|que equipos|equipos|integrantes|conforman)/.test(t))
        return "ver_grupo";

    if (/^grupos$/i.test(t) || /(dame|mostrar|ver|lista|cuales|todos los).*(grupos)\b/.test(t))
        return "ver_grupos";

    if (/(cuantos equipos|cuantas selecciones|numero de equipos|total de equipos|equipos hay)/.test(t))
        return "cuantos_equipos";

    if (/(cuantos grupos|numero de grupos|total de grupos)/.test(t))
        return "cuantos_grupos";

    if (/(cuantos (equipos |selecciones )?(clasifican|pasan|avanzan)|cuantos (van a|llegan a) eliminatorias)/.test(t))
        return "cuantos_clasifican";

    if (/(ranking de|ranking fifa de|posicion fifa de|puesto de|en que puesto esta|que ranking tiene)/.test(t))
        return "ver_ranking";

    if (/(quien tiene mejor ranking|quien esta mejor rankeado|quien es favorito entre|quien es mejor entre)/.test(t))
        return "comparar_equipos";

    if (/(quien tiene el mejor ranking|cual es la mejor seleccion|quien esta primero|mejor seleccion del mundo)/.test(t))
        return "mejor_ranking";

    if (/(top 10|los 10 mejores|mejores 10|top diez)/.test(t)) return "top_10_ranking";
    if (/(top 5|los 5 mejores|mejores 5|top cinco)/.test(t)) return "top_5_ranking";

    if (/(equipos de|selecciones de|quien clasifica de|cuales son los equipos de)/.test(t) && extraerConfederacion(t))
        return "equipos_por_confederacion";

    if (/(confederacion de|confederacion|a que confederacion pertenece)/.test(t))
        return "confederacion_equipo";

    if (/(grupo mas fuerte|grupo de la muerte|grupo dificil|grupo complicado)/.test(t))
        return "grupo_mas_fuerte";

    if (/(grupo mas debil|grupo mas facil|grupo sencillo)/.test(t))
        return "grupo_mas_debil";

    if (/(promedio de ranking|ranking promedio|ranking medio).*(grupo)/.test(t) || /(grupo).*promedio/.test(t))
        return "promedio_ranking_grupo";

    if (/(quien es el favorito|favorito del grupo|mejor equipo del grupo|mas fuerte del grupo)/.test(t) && extraerGrupo(t))
        return "favorito_grupo";

    if (/(quien ganara el mundial|quien es el favorito a ganar|quien tiene mas chances|quien va a ganar)/.test(t))
        return "favorito_campeon";

    if (/(esta en el mundial|clasifica al mundial|fue al mundial|participa en el mundial|juega el mundial)/.test(t))
        return "equipo_en_mundial";

    if (/(lista|dame|muestra|todos).*(equipos|selecciones)/.test(t) && !/(grupo|ranking)/.test(t))
        return "listar_todos_equipos";

    if (/(cuales equipos|que equipos).*(mas puntos|mayor puntaje|mas puntos fifa)/.test(t))
        return "equipos_mas_puntos";

    if (/(quienes clasificaron|quienes pasaron|equipos clasificados|clasificados a eliminatorias)/.test(t))
        return "ver_clasificados";

    if (/(mejores terceros|cuales son los mejores terceros|quienes fueron los terceros)/.test(t))
        return "ver_mejores_terceros";

    if (/(cuando es el mundial|cuando se juega|fechas del mundial|en que ano)/.test(t))
        return "cuando_mundial";

    if (/(donde (es|sera|se juega)|sede|ciudad(es)?|estadio(s)?).*(mundial)/.test(t) ||
        /(mundial).*(donde|sede)/.test(t))
        return "sede_mundial";

    if (/(formato del mundial|como funciona|cuantas fases|como se juega el mundial|estructura del torneo)/.test(t))
        return "formato_mundial";

    if (/(quien organiza|organizadores|organizacion del mundial)/.test(t))
        return "organizador_mundial";

    if (/(ultimo campeon|quien gano el ultimo|campeon del mundo actual|quien es el campeon del mundo|quien fue campeon en el mundial)/.test(t))
        return "conocimiento";

    if (/(subcampeon|quien fue el subcampeon)/.test(t))
        return "conocimiento";

    if (/(quien gano la simulacion|campeon simulado|quien es el campeon simulado)/.test(t))
        return "ver_campeon_simulado";

    if (/(cuantos puntos tiene|puntos fifa de|puntaje de)/.test(t))
        return "ver_puntos";

    if (/(diferencia de puntos|cuantos puntos (le lleva|de diferencia)|diferencia entre)/.test(t))
        return "diferencia_puntos";

    if (/(que puedes hacer|que sabes|ayuda|help|que preguntas|para que sirves|que eres)/.test(t))
        return "ayuda";

    if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|saludos)$/.test(t))
        return "saludo";

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
    if (result.rows.length > 0 && Number(result.rows[0].similitud) >= 0.60)
        return result.rows[0].respuesta;
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
        `SELECT clave, pregunta_base, respuesta, datos, fuente
         FROM conocimiento_mundial WHERE clave = $1 LIMIT 1`,
        [clave]
    );
    return result.rows[0] || null;
}

async function buscarConocimientoUsuario(pregunta) {
    const textoNorm = normalizarTexto(pregunta);
    const r1 = await pool.query(
        `SELECT clave, pregunta_base, respuesta,
                similarity(pregunta_base, $1) AS similitud
         FROM conocimiento_mundial
         WHERE fuente = 'usuario'
         ORDER BY similarity(pregunta_base, $1) DESC LIMIT 1`,
        [textoNorm]
    );
    if (r1.rows.length > 0 && Number(r1.rows[0].similitud) >= 0.50)
        return r1.rows[0];
    return null;
}

async function buscarConocimientoSimilar(pregunta) {
    const textoNorm = normalizarTexto(pregunta);
    const r1 = await pool.query(
        `SELECT clave, pregunta_base, respuesta,
                similarity(pregunta_base, $1) AS similitud
         FROM conocimiento_mundial
         ORDER BY similarity(pregunta_base, $1) DESC LIMIT 1`,
        [textoNorm]
    );
    if (r1.rows.length > 0 && Number(r1.rows[0].similitud) >= 0.50)
        return r1.rows[0];
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
    const result = await pool.query(
        "SELECT datos FROM simulacion_grupos_actual ORDER BY id DESC LIMIT 1"
    );
    return result.rows.length > 0 ? result.rows[0].datos : null;
}

function respuestaFueraDeDominio() {
    return (
        "Soy una IA especializada en el Mundial 2026. Puedo ayudarte con:\n" +
        "- Grupos y equipos participantes\n" +
        "- Ranking FIFA y confederaciones\n" +
        "- Simulaciones de grupos y eliminatorias\n" +
        "- Clasificados y cruces\n" +
        "- Informacion general del torneo\n\n" +
        "En que te puedo ayudar sobre el Mundial?"
    );
}

function formatearRespuestaConocimiento(conocimiento) {
    const formatos = {
        ultimo_campeon_mundo: `El ultimo campeon del mundo es ${conocimiento.respuesta}.`,
        subcampeon_mundo: `El subcampeon del mundo es ${conocimiento.respuesta}.`,
        sede_mundial_2026: conocimiento.respuesta,
        fecha_mundial_2026: conocimiento.respuesta,
        goleador_historico_mundial: conocimiento.respuesta,
    };
    if (formatos[conocimiento.clave]) return formatos[conocimiento.clave];
    const r = conocimiento.respuesta.trim();
    return r.charAt(0).toUpperCase() + r.slice(1);
}

function calcularRankingPromedioGrupo(equiposGrupo) {
    const rankings = equiposGrupo.filter((e) => e.ranking && e.ranking < 900).map((e) => e.ranking);
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

        const entidades = {
            grupo, gruposMultiples, grupoExcluido,
            equipo, equiposComparacion, confederacion,
            clave_conocimiento: null,
        };

        let respuesta = "__pendiente__";
        let simulData = null;

        if (intent === "ensenar_conocimiento") {
            const contenido = limpiarEnsenanza(pregunta);
            if (contenido.length > 3) {
                const matchEs = contenido.match(/^(.+?)\s+(es|fue|sera|son|fueron)\s+(.+)$/i);
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
                respuesta = `Aprendido. He guardado: "${contenido}". La proxima vez que preguntes sobre esto lo recordare.`;
                intent = "aprendizaje_confirmado";
            } else {
                respuesta = "No entendi bien que debo aprender. Ejemplo: aprende que la mascota del Mundial se llama Taino";
            }
            await pool.query(
                "INSERT INTO consultas (pregunta, respuesta, intent, entidades) VALUES ($1, $2, $3, $4)",
                [pregunta, respuesta, intent, JSON.stringify(entidades)]
            );
            return res.json({ respuesta, intent, simulData });
        }

        const conocimientoUsuario = await buscarConocimientoUsuario(pregunta);
        if (conocimientoUsuario) {
            respuesta = formatearRespuestaConocimiento(conocimientoUsuario);
            await pool.query(
                "INSERT INTO consultas (pregunta, respuesta, intent, entidades) VALUES ($1, $2, $3, $4)",
                [pregunta, respuesta, "conocimiento_usuario", JSON.stringify(entidades)]
            );
            return res.json({ respuesta, intent, simulData });
        }

        const patron = await buscarPatronMundial(pregunta);
        if (patron?.intencion && (intent === "desconocido" || patron.intencion === "conocimiento")) {
            intent = patron.intencion;
            entidades.clave_conocimiento = patron.clave_conocimiento || null;
        }

        const pendiente = await obtenerAprendizajePendiente();
        if (pendiente && pendiente.entidades?.clave_conocimiento) {
            const t = normalizarTexto(pregunta);
            const bloqueadas = ["simula", "grupo", "grupos", "ranking", "clasificados", "campeon", "mundial", "cuando", "donde"];
            const esProbableRespuesta = t.length > 0 && t.length < 120 && !bloqueadas.some((x) => t.includes(x));
            if (esProbableRespuesta) {
                const clave = pendiente.entidades.clave_conocimiento;
                await guardarConocimiento(clave, pendiente.pregunta, pregunta.trim(), "usuario");
                respuesta = "Perfecto. He guardado esa informacion. Gracias por ensenarme.";
                intent = "aprendizaje_confirmado";
                await pool.query(
                    "INSERT INTO consultas (pregunta, respuesta, intent, entidades) VALUES ($1, $2, $3, $4)",
                    [pregunta, respuesta, intent, JSON.stringify({ aprendio_clave: clave })]
                );
                return res.json({ respuesta, intent, simulData });
            }
        }

        if (patron?.intencion === "conocimiento" && patron?.clave_conocimiento) {
            const conocimiento = await obtenerConocimientoPorClave(patron.clave_conocimiento);
            if (conocimiento) {
                respuesta = formatearRespuestaConocimiento(conocimiento);
                intent = "conocimiento";
            } else {
                respuesta = "No tengo ese dato guardado aun. Si lo sabes, dimelo asi: aprende que [la respuesta]";
                intent = "aprendizaje_pendiente";
                entidades.clave_conocimiento = patron.clave_conocimiento;
            }
        }

        if (respuesta === "__pendiente__") {

            if (intent === "saludo") {
                respuesta = "Hola. Soy la IA del Mundial 2026.\nPuedes preguntarme sobre grupos, equipos, rankings, simulaciones y mucho mas. En que te ayudo?";
            }

            else if (intent === "ayuda") {
                respuesta =
                    "Puedo responder preguntas como:\n\n" +
                    "Grupos: Que equipos estan en el Grupo A?\n" +
                    "Ranking: En que ranking esta Brasil?\n" +
                    "Confederacion: A que confederacion pertenece Japon?\n" +
                    "Campeon: Quien es el campeon del mundo?\n" +
                    "Favorito: Quien ganara el Mundial?\n" +
                    "Partido: Quien le gana a Francia vs Argentina?\n" +
                    "Top: Muestrame el Top 10 del ranking FIFA\n" +
                    "Grupo mas fuerte: Cual es el grupo de la muerte?\n" +
                    "Simular: Simula la fase de grupos\n" +
                    "Comparar: Quien tiene mejor ranking, Espana o Francia?\n\n" +
                    "Y puedes ensenarme cosas nuevas: aprende que [dato]";
            }

            else if (intent === "ver_grupos") {
                const memoria = await buscarMemoriaSimilar(pregunta, intent);
                if (memoria) {
                    respuesta = memoria;
                } else {
                    const lista = Object.keys(grupos).sort()
                        .map((g) => `Grupo ${g}:\n- ${grupos[g].map((e) => e.nombre).join("\n- ")}`)
                        .join("\n\n");
                    respuesta = `Estos son los 12 grupos del Mundial 2026:\n\n${lista}`;
                }
            }

            else if (intent === "ver_grupos_excluyendo" && grupoExcluido) {
                const lista = Object.keys(grupos).sort()
                    .filter((g) => g !== grupoExcluido)
                    .map((g) => `Grupo ${g}:\n- ${grupos[g].map((e) => e.nombre).join("\n- ")}`)
                    .join("\n\n");
                respuesta = `Todos los grupos excepto el Grupo ${grupoExcluido}:\n\n${lista}`;
            }

            else if (intent === "ver_grupos_multiples" && gruposMultiples.length > 0) {
                const validos = gruposMultiples.filter((g) => grupos[g]);
                if (validos.length > 0) {
                    respuesta = validos.sort()
                        .map((g) => `Grupo ${g}:\n- ${grupos[g].map((e) => e.nombre).join("\n- ")}`)
                        .join("\n\n");
                } else {
                    respuesta = "No encontre los grupos solicitados.";
                }
            }

            else if (intent === "ver_grupo" && grupo) {
                if (grupos[grupo]) {
                    const lista = grupos[grupo].map((e, i) => `${i + 1}. ${e.nombre} (Ranking FIFA: #${e.ranking})`).join("\n");
                    respuesta = `Equipos del Grupo ${grupo}:\n\n${lista}`;
                } else {
                    respuesta = `No encontre informacion para el Grupo ${grupo}.`;
                }
            }

            else if (intent === "cuantos_equipos") {
                const r = await pool.query(
                    "SELECT COUNT(*) FROM equipos WHERE nombre NOT LIKE '%UEFA%' AND nombre NOT LIKE '%REPECHAJE%'"
                );
                respuesta = `El Mundial 2026 cuenta con ${r.rows[0].count} selecciones participantes, distribuidas en 12 grupos de 4 equipos cada uno.`;
            }

            else if (intent === "cuantos_grupos") {
                respuesta = "El Mundial 2026 tiene 12 grupos (del A al L), con 4 equipos cada uno. En total participan 48 selecciones.";
            }

            else if (intent === "cuantos_clasifican") {
                respuesta = "De cada grupo clasifican los 2 primeros.\nAdemas, los 8 mejores terceros tambien avanzan.\n\nTotal: 56 equipos pasan a dieciseisavos de final.";
            }

            else if (intent === "ver_ranking" && equipo) {
                const r = await pool.query(
                    "SELECT nombre, ranking_fifa, puntos_fifa, confederacion FROM equipos WHERE nombre = $1", [equipo]
                );
                if (r.rows.length > 0) {
                    const e = r.rows[0];
                    respuesta = `Ranking FIFA de ${e.nombre}:\n- Posicion: #${e.ranking_fifa}\n- Puntos FIFA: ${e.puntos_fifa}\n- Confederacion: ${e.confederacion}`;
                } else {
                    respuesta = `No encontre el ranking de "${equipo}".`;
                }
            }
            else if (intent === "ver_ranking" && !equipo) {
                respuesta = "De que equipo quieres ver el ranking? Ejemplo: En que ranking esta Brasil?";
            }

            else if (intent === "ver_puntos" && equipo) {
                const r = await pool.query(
                    "SELECT nombre, puntos_fifa, ranking_fifa FROM equipos WHERE nombre = $1", [equipo]
                );
                if (r.rows.length > 0) {
                    const e = r.rows[0];
                    respuesta = `${e.nombre} tiene ${e.puntos_fifa} puntos FIFA (puesto #${e.ranking_fifa}).`;
                } else {
                    respuesta = `No encontre los puntos de "${equipo}".`;
                }
            }

            else if (intent === "diferencia_puntos" && equiposComparacion.length >= 2) {
                const [nA, nB] = equiposComparacion;
                const eA = await obtenerEquipoPorNombre(nA);
                const eB = await obtenerEquipoPorNombre(nB);
                if (eA && eB) {
                    const diff = Math.abs(eA.puntos_fifa - eB.puntos_fifa);
                    const mejor = eA.puntos_fifa > eB.puntos_fifa ? eA : eB;
                    respuesta = `Diferencia de puntos FIFA entre ${nA} (${eA.puntos_fifa} pts) y ${nB} (${eB.puntos_fifa} pts): ${diff} puntos.\n${mejor.nombre} esta por encima.`;
                } else {
                    respuesta = "No pude encontrar los datos de ambos equipos.";
                }
            }

            else if (intent === "comparar_equipos" && equiposComparacion.length >= 2) {
                const [nA, nB] = equiposComparacion;
                const eA = await obtenerEquipoPorNombre(nA);
                const eB = await obtenerEquipoPorNombre(nB);
                if (eA && eB) {
                    const mejor = Number(eA.ranking_fifa) < Number(eB.ranking_fifa) ? eA : eB;
                    respuesta =
                        `Comparacion FIFA:\n\n` +
                        `- ${eA.nombre}: Ranking #${eA.ranking_fifa} | ${eA.puntos_fifa} pts\n` +
                        `- ${eB.nombre}: Ranking #${eB.ranking_fifa} | ${eB.puntos_fifa} pts\n\n` +
                        `${mejor.nombre} esta mejor posicionado por ${Math.abs(Number(eA.ranking_fifa) - Number(eB.ranking_fifa))} puestos.`;
                } else {
                    respuesta = "No pude comparar esos equipos. Verifica los nombres.";
                }
            }

            else if (intent === "mejor_ranking") {
                const r = await pool.query(
                    "SELECT nombre, ranking_fifa, puntos_fifa FROM equipos WHERE ranking_fifa IS NOT NULL AND ranking_fifa < 900 ORDER BY ranking_fifa ASC LIMIT 1"
                );
                if (r.rows.length > 0) {
                    const e = r.rows[0];
                    respuesta = `La seleccion con mejor ranking FIFA en el Mundial 2026 es ${e.nombre}, posicion #${e.ranking_fifa} con ${e.puntos_fifa} puntos.`;
                } else {
                    respuesta = "No encontre datos de ranking FIFA.";
                }
            }

            else if (intent === "top_10_ranking") {
                const r = await pool.query(
                    "SELECT nombre, ranking_fifa, puntos_fifa FROM equipos WHERE ranking_fifa < 900 ORDER BY ranking_fifa ASC LIMIT 10"
                );
                const lista = r.rows.map((e, i) => `${i + 1}. ${e.nombre} - #${e.ranking_fifa} (${e.puntos_fifa} pts)`).join("\n");
                respuesta = `Top 10 del ranking FIFA en el Mundial 2026:\n\n${lista}`;
            }

            else if (intent === "top_5_ranking") {
                const r = await pool.query(
                    "SELECT nombre, ranking_fifa, puntos_fifa FROM equipos WHERE ranking_fifa < 900 ORDER BY ranking_fifa ASC LIMIT 5"
                );
                const lista = r.rows.map((e, i) => `${i + 1}. ${e.nombre} - #${e.ranking_fifa} (${e.puntos_fifa} pts)`).join("\n");
                respuesta = `Top 5 del ranking FIFA en el Mundial 2026:\n\n${lista}`;
            }

            else if (intent === "equipos_mas_puntos") {
                const r = await pool.query(
                    "SELECT nombre, puntos_fifa, ranking_fifa FROM equipos WHERE puntos_fifa > 0 ORDER BY puntos_fifa DESC LIMIT 10"
                );
                const lista = r.rows.map((e, i) => `${i + 1}. ${e.nombre} - ${e.puntos_fifa} pts (Rank #${e.ranking_fifa})`).join("\n");
                respuesta = `Equipos con mas puntos FIFA en el Mundial 2026:\n\n${lista}`;
            }

            else if (intent === "confederacion_equipo" && equipo) {
                const e = await obtenerEquipoPorNombre(equipo);
                if (e) {
                    respuesta = `${e.nombre} pertenece a la confederacion ${e.confederacion}.`;
                } else {
                    respuesta = `No encontre la confederacion de "${equipo}".`;
                }
            }

            else if (intent === "equipos_por_confederacion" && confederacion) {
                const r = await pool.query(
                    "SELECT nombre, ranking_fifa FROM equipos WHERE confederacion = $1 AND ranking_fifa < 900 ORDER BY ranking_fifa ASC",
                    [confederacion]
                );
                if (r.rows.length > 0) {
                    const lista = r.rows.map((e) => `- ${e.nombre} (Ranking #${e.ranking_fifa})`).join("\n");
                    respuesta = `Equipos de ${confederacion} en el Mundial 2026 (${r.rows.length}):\n\n${lista}`;
                } else {
                    respuesta = `No encontre equipos de ${confederacion}.`;
                }
            }

            else if (intent === "grupo_de_equipo" && equipo) {
                const r = await pool.query(
                    `SELECT g.nombre AS grupo FROM grupo_equipos ge
                     JOIN equipos e ON ge.equipo_id = e.id
                     JOIN grupos g ON ge.grupo_id = g.id
                     WHERE e.nombre = $1 LIMIT 1`, [equipo]
                );
                if (r.rows.length > 0) {
                    const grupoEquipo = r.rows[0].grupo;
                    const companeros = (grupos[grupoEquipo] || []).filter((e) => e.nombre !== equipo).map((e) => e.nombre);
                    respuesta = `${equipo} esta en el Grupo ${grupoEquipo}.\nSus rivales: ${companeros.join(", ")}.`;
                } else {
                    respuesta = `No encontre el grupo de "${equipo}".`;
                }
            }
            else if (intent === "grupo_de_equipo" && !equipo) {
                respuesta = "De que equipo quieres saber el grupo? Ejemplo: En que grupo esta Brasil?";
            }

            else if (intent === "equipo_en_mundial" && equipo) {
                const r = await pool.query(
                    `SELECT e.nombre FROM equipos e JOIN grupo_equipos ge ON e.id = ge.equipo_id WHERE e.nombre = $1 LIMIT 1`, [equipo]
                );
                respuesta = r.rows.length > 0
                    ? `Si, ${equipo} esta clasificado al Mundial 2026.`
                    : `${equipo} no aparece en la lista del Mundial 2026.`;
            }
            else if (intent === "equipo_en_mundial" && !equipo) {
                respuesta = "De que seleccion quieres saber si esta en el Mundial?";
            }

            else if (intent === "listar_todos_equipos") {
                const r = await pool.query(
                    "SELECT nombre, confederacion, ranking_fifa FROM equipos WHERE ranking_fifa < 900 ORDER BY ranking_fifa ASC"
                );
                const lista = r.rows.map((e) => `- ${e.nombre} (${e.confederacion}, #${e.ranking_fifa})`).join("\n");
                respuesta = `Todas las selecciones del Mundial 2026 (${r.rows.length} equipos):\n\n${lista}`;
            }

            else if (intent === "grupo_mas_fuerte") {
                let mejorGrupo = null, menorPromedio = 999;
                for (const g of Object.keys(grupos)) {
                    const prom = calcularRankingPromedioGrupo(grupos[g]);
                    if (prom < menorPromedio) { menorPromedio = prom; mejorGrupo = g; }
                }
                if (mejorGrupo) {
                    const lista = grupos[mejorGrupo].map((e) => `${e.nombre} (#${e.ranking})`).join(", ");
                    respuesta = `El Grupo ${mejorGrupo} es el grupo mas fuerte (ranking promedio: #${menorPromedio}).\nEquipos: ${lista}`;
                } else {
                    respuesta = "No pude calcular el grupo mas fuerte.";
                }
            }

            else if (intent === "grupo_mas_debil") {
                let grupoDebil = null, mayorPromedio = 0;
                for (const g of Object.keys(grupos)) {
                    const prom = calcularRankingPromedioGrupo(grupos[g]);
                    if (prom > mayorPromedio) { mayorPromedio = prom; grupoDebil = g; }
                }
                if (grupoDebil) {
                    const lista = grupos[grupoDebil].map((e) => `${e.nombre} (#${e.ranking})`).join(", ");
                    respuesta = `El Grupo ${grupoDebil} es el mas accesible (ranking promedio: #${mayorPromedio}).\nEquipos: ${lista}`;
                } else {
                    respuesta = "No pude calcular el grupo mas debil.";
                }
            }

            else if (intent === "promedio_ranking_grupo" && grupo) {
                if (grupos[grupo]) {
                    const prom = calcularRankingPromedioGrupo(grupos[grupo]);
                    const lista = grupos[grupo].map((e) => `${e.nombre} (#${e.ranking})`).join(", ");
                    respuesta = `Grupo ${grupo} - ranking promedio: #${prom}.\nEquipos: ${lista}`;
                } else {
                    respuesta = `No encontre el Grupo ${grupo}.`;
                }
            }

            else if (intent === "favorito_grupo" && grupo) {
                if (grupos[grupo]) {
                    const favorito = [...grupos[grupo]].filter((e) => e.ranking < 900).sort((a, b) => a.ranking - b.ranking)[0];
                    respuesta = `El favorito del Grupo ${grupo} es ${favorito.nombre} (Ranking #${favorito.ranking}).`;
                } else {
                    respuesta = `No encontre el Grupo ${grupo}.`;
                }
            }

            else if (intent === "favorito_campeon") {
                const r = await pool.query(
                    "SELECT nombre, ranking_fifa, puntos_fifa FROM equipos WHERE ranking_fifa < 900 ORDER BY ranking_fifa ASC LIMIT 5"
                );
                if (r.rows.length > 0) {
                    const lista = r.rows.map((e, i) => `${i + 1}. ${e.nombre} (#${e.ranking_fifa})`).join("\n");
                    respuesta = `Favorito segun ranking FIFA: ${r.rows[0].nombre}.\n\nTop 5 candidatos:\n${lista}\n\nEn el futbol siempre hay sorpresas.`;
                } else {
                    respuesta = "No encontre datos para calcular el favorito.";
                }
            }

            else if (intent === "simular_partido" && equiposComparacion.length >= 2) {
                const [nA, nB] = equiposComparacion;
                const eA = await obtenerEquipoPorNombre(nA);
                const eB = await obtenerEquipoPorNombre(nB);
                if (eA && eB) {
                    const rankA = Number(eA.ranking_fifa) || 999;
                    const rankB = Number(eB.ranking_fifa) || 999;
                    const fuerzaA = 1 / rankA, fuerzaB = 1 / rankB;
                    let probA = fuerzaA / (fuerzaA + fuerzaB);
                    const diff = rankB - rankA;
                    probA += diff > 0 ? Math.min(diff * 0.004, 0.25) : Math.max(diff * 0.004, -0.25);
                    probA = Math.max(0.05, Math.min(0.95, probA));
                    const ganaA = Math.random() < probA;
                    const golesGanador = Math.floor(Math.random() * 3) + 1;
                    const golesSegundo = Math.floor(Math.random() * golesGanador);
                    const [gA, gB] = ganaA ? [golesGanador, golesSegundo] : [golesSegundo, golesGanador];
                    respuesta =
                        `Simulacion:\n\n${nA} ${gA} - ${gB} ${nB}\n\n` +
                        `Ganador: ${ganaA ? nA : nB}\nBasado en ranking FIFA. Cada simulacion puede variar.`;
                } else {
                    respuesta = "Para simular necesito dos equipos. Ejemplo: Quien gana entre Espana y Brasil?";
                }
            }
            else if (intent === "simular_partido") {
                respuesta = "Para simular un partido necesito dos equipos. Ejemplo: Quien le gana a Argentina vs Francia?";
            }

            else if (intent === "simular_grupos" && gruposMultiples.length > 0) {
                const { resultadosPorGrupo } = simularGruposSeleccionados(grupos, gruposMultiples);
                const gruposKeys = Object.keys(resultadosPorGrupo).sort();
                respuesta = `Simulacion de Grupo${gruposKeys.length > 1 ? "s" : ""} ${gruposKeys.join(", ")} completada.`;
                simulData = {
                    tipo: "grupos",
                    grupos: gruposKeys.map(g => ({
                        grupo: g,
                        partidos: resultadosPorGrupo[g].partidos,
                        tabla: resultadosPorGrupo[g].tabla,
                        clasificados: resultadosPorGrupo[g].clasificados,
                    }))
                };
            }

            else if (intent === "simular_mundial") {
                const { resultadosPorGrupo, clasificados, mejoresTerceros } = simularFaseDeGrupos(grupos);
                respuesta = "Simulacion completa de la fase de grupos finalizada.";
                simulData = {
                    tipo: "mundial",
                    grupos: Object.keys(resultadosPorGrupo).sort().map(g => ({
                        grupo: g,
                        partidos: resultadosPorGrupo[g].partidos,
                        tabla: resultadosPorGrupo[g].tabla,
                        clasificados: resultadosPorGrupo[g].clasificados,
                    })),
                    clasificados: [...clasificados].sort((a, b) =>
                        a.posicion !== b.posicion ? a.posicion - b.posicion : a.grupo.localeCompare(b.grupo)
                    ),
                    mejoresTerceros,
                };
                await pool.query("DELETE FROM simulacion_grupos_actual");
                await pool.query("INSERT INTO simulacion_grupos_actual (datos) VALUES ($1)",
                    [JSON.stringify({ resultadosPorGrupo, clasificados, mejoresTerceros })]);
            }

            else if (intent === "ver_clasificados") {
                const datos = await obtenerSimulacionActual();
                if (!datos) {
                    respuesta = "Aun no hay simulacion guardada. Usa: Simula la fase de grupos.";
                } else {
                    const texto = datos.clasificados
                        .sort((a, b) => a.posicion !== b.posicion ? a.posicion - b.posicion : a.grupo.localeCompare(b.grupo))
                        .map((c) => `Grupo ${c.grupo} (${c.posicion}): ${c.nombre}`).join("\n");
                    respuesta = `Clasificados a eliminatorias:\n\n${texto}`;
                }
            }

            else if (intent === "ver_mejores_terceros") {
                const datos = await obtenerSimulacionActual();
                if (!datos?.mejoresTerceros) {
                    respuesta = "No hay simulacion. Primero simula la fase de grupos.";
                } else {
                    const texto = datos.mejoresTerceros
                        .map((c) => `Grupo ${c.grupo}: ${c.nombre} | Pts:${c.puntos} DG:${c.dg} GF:${c.gf}`).join("\n");
                    respuesta = `8 mejores terceros:\n\n${texto}`;
                }
            }

            else if (intent === "cuando_mundial") {
                respuesta = "El Mundial 2026 se celebrara del 11 de junio al 19 de julio de 2026.";
            }

            else if (intent === "sede_mundial") {
                const c = await obtenerConocimientoPorClave("sede_mundial_2026");
                respuesta = c ? c.respuesta : "El Mundial 2026 sera en Estados Unidos, Canada y Mexico.";
            }

            else if (intent === "organizador_mundial") {
                respuesta = "El Mundial 2026 es organizado por FIFA, con EE.UU. (11 ciudades), Mexico (3) y Canada (2) como co-sedes.";
            }

            else if (intent === "formato_mundial") {
                respuesta =
                    "Formato del Mundial 2026:\n\n" +
                    "- 48 equipos en 12 grupos de 4\n" +
                    "- Clasifican: 2 primeros de cada grupo + 8 mejores terceros\n" +
                    "- Fases: 16avos, Octavos, Cuartos, Semis, Final\n" +
                    "- Fechas: 11 junio - 19 julio 2026\n" +
                    "- Sede: EE.UU., Mexico y Canada";
            }

            else if (intent === "ver_campeon_simulado") {
                respuesta = "El campeon simulado se decide en la vista de eliminatorias. Pulsa Simular eliminatorias y ejecuta todas las rondas.";
            }

            else {
                const conocido = await buscarConocimientoSimilar(pregunta);
                if (conocido) {
                    respuesta = formatearRespuestaConocimiento(conocido);
                    intent = "conocimiento_aprendido";
                } else {
                    respuesta = respuestaFueraDeDominio();
                    intent = "fuera_de_dominio";
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
        const clasificadosOrdenados = datos.clasificados
            .sort((a, b) => a.posicion !== b.posicion ? a.posicion - b.posicion : a.grupo.localeCompare(b.grupo))
            .map((c) => ({ grupo: c.grupo, posicion: c.posicion, nombre: c.nombre, ranking: c.ranking, puntos: c.puntos, dg: c.dg, gf: c.gf }));
        res.json({ clasificados: clasificadosOrdenados });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al obtener clasificados" });
    }
});

app.get("/api/eliminatorias/16vos", async (req, res) => {
    try {
        const result = await pool.query("SELECT datos FROM simulacion_grupos_actual ORDER BY id DESC LIMIT 1");
        if (result.rows.length === 0) return res.status(404).json({ error: "No hay simulacion guardada" });
        const datos = result.rows[0].datos;
        const cruces = generarCrucesDieciseisavos(datos.clasificados);
        res.json({ cruces });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al generar los 16vos" });
    }
});

app.get("/api/conocimiento", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT clave, pregunta_base, respuesta, fuente, fecha FROM conocimiento_mundial ORDER BY fecha DESC"
        );
        res.json({ conocimiento: result.rows });
    } catch (error) {
        res.status(500).json({ error: "Error al obtener conocimiento" });
    }
});

app.get("/api/estadisticas", async (req, res) => {
    try {
        const total = await pool.query("SELECT COUNT(*) FROM consultas");
        const porIntent = await pool.query(
            "SELECT intent, COUNT(*) as total FROM consultas WHERE intent IS NOT NULL GROUP BY intent ORDER BY total DESC LIMIT 10"
        );
        const sinResponder = await pool.query(
            "SELECT COUNT(*) FROM consultas WHERE intent IN ('fuera_de_dominio', 'desconocido')"
        );
        res.json({
            total_consultas: total.rows[0].count,
            top_intents: porIntent.rows,
            sin_responder: sinResponder.rows[0].count,
        });
    } catch (error) {
        res.status(500).json({ error: "Error al obtener estadisticas" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor IA Mundial 2026 en http://localhost:${PORT}`));