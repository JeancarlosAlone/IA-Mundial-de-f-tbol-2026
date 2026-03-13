const pool = require("../database/db");

async function obtenerEquiposPorGrupo() {
    const sql = `
        SELECT g.nombre AS grupo, e.nombre AS equipo, e.ranking_fifa
        FROM grupo_equipos ge
        JOIN equipos e ON ge.equipo_id = e.id
        JOIN grupos g ON ge.grupo_id = g.id
        ORDER BY g.nombre, e.ranking_fifa;
    `;
    const result = await pool.query(sql);
    const grupos = {};
    result.rows.forEach((row) => {
        if (!grupos[row.grupo]) grupos[row.grupo] = [];
        grupos[row.grupo].push({ nombre: row.equipo, ranking: Number(row.ranking_fifa) });
    });
    return grupos;
}

function esPlaceholder(nombre = "") {
    return /UEFA|REPECHAJE/i.test(nombre);
}

function rankingAjustado(equipo) {
    let ranking = Number(equipo.ranking ?? equipo.ranking_fifa ?? 999);
    if (!Number.isFinite(ranking) || ranking <= 0) ranking = 999;
    if (esPlaceholder(equipo.nombre)) ranking += 250;
    return ranking;
}

function calcularProbabilidadVictoria(equipoA, equipoB, tipo = "grupos") {
    const rankingA = rankingAjustado(equipoA);
    const rankingB = rankingAjustado(equipoB);
    const fuerzaA = 1 / rankingA;
    const fuerzaB = 1 / rankingB;
    let probA = fuerzaA / (fuerzaA + fuerzaB);
    const diferencia = rankingB - rankingA;
    if (tipo === "eliminatoria") {
        if (diferencia > 0) probA += Math.min(diferencia * 0.0045, 0.30);
        if (diferencia < 0) probA -= Math.min(Math.abs(diferencia) * 0.0045, 0.30);
        if (probA < 0.03) probA = 0.03;
        if (probA > 0.97) probA = 0.97;
    } else {
        if (diferencia > 0) probA += Math.min(diferencia * 0.0028, 0.18);
        if (diferencia < 0) probA -= Math.min(Math.abs(diferencia) * 0.0028, 0.18);
        if (probA < 0.12) probA = 0.12;
        if (probA > 0.88) probA = 0.88;
    }
    return probA;
}

function simularPartido(equipoA, equipoB) {
    const probA = calcularProbabilidadVictoria(equipoA, equipoB, "grupos");
    return Math.random() < probA ? equipoA : equipoB;
}

function simularPartidoEliminatoria(equipoA, equipoB) {
    const probA = calcularProbabilidadVictoria(equipoA, equipoB, "eliminatoria");
    return Math.random() < probA ? equipoA : equipoB;
}

function simularPartidoConMarcador(equipoA, equipoB) {
    const rankingA = rankingAjustado(equipoA);
    const rankingB = rankingAjustado(equipoB);
    const diferenciaRanking = Math.abs(rankingA - rankingB);
    const probA = calcularProbabilidadVictoria(equipoA, equipoB, "grupos");
    let golesA = 0;
    let golesB = 0;
    let probEmpate = 0.22;
    if (diferenciaRanking <= 10) probEmpate = 0.28;
    else if (diferenciaRanking <= 25) probEmpate = 0.22;
    else probEmpate = 0.12;
    const random = Math.random();
    if (random < probEmpate) {
        const empates = [{ a: 0, b: 0 }, { a: 1, b: 1 }, { a: 1, b: 1 }, { a: 2, b: 2 }];
        const empate = empates[Math.floor(Math.random() * empates.length)];
        golesA = empate.a;
        golesB = empate.b;
        return { golesA, golesB };
    }
    const ganaA = Math.random() < probA;
    if (diferenciaRanking <= 10) {
        if (ganaA) { golesA = Math.floor(Math.random() * 2) + 1; golesB = Math.floor(Math.random() * 2); }
        else { golesB = Math.floor(Math.random() * 2) + 1; golesA = Math.floor(Math.random() * 2); }
    } else if (diferenciaRanking <= 30) {
        if (ganaA) { golesA = Math.floor(Math.random() * 3) + 1; golesB = Math.floor(Math.random() * 2); }
        else { golesB = Math.floor(Math.random() * 3) + 1; golesA = Math.floor(Math.random() * 2); }
    } else {
        if (ganaA) { golesA = Math.floor(Math.random() * 4) + 1; golesB = Math.floor(Math.random() * 2); }
        else { golesB = Math.floor(Math.random() * 4) + 1; golesA = Math.floor(Math.random() * 2); }
    }
    return { golesA, golesB };
}

function initTabla(equipos) {
    const tabla = {};
    equipos.forEach((e) => {
        tabla[e.nombre] = { nombre: e.nombre, ranking: e.ranking, puntos: 0, gf: 0, gc: 0, dg: 0 };
    });
    return tabla;
}

function aplicarResultado(tabla, equipoA, equipoB, golesA, golesB) {
    const a = tabla[equipoA.nombre];
    const b = tabla[equipoB.nombre];
    a.gf += golesA; a.gc += golesB; b.gf += golesB; b.gc += golesA;
    a.dg = a.gf - a.gc; b.dg = b.gf - b.gc;
    if (golesA > golesB) { a.puntos += 3; }
    else if (golesB > golesA) { b.puntos += 3; }
    else { a.puntos += 1; b.puntos += 1; }
}

function ordenarTabla(tablaObj) {
    const arr = Object.values(tablaObj);
    arr.sort((x, y) => {
        if (y.puntos !== x.puntos) return y.puntos - x.puntos;
        if (y.dg !== x.dg) return y.dg - x.dg;
        if (y.gf !== x.gf) return y.gf - x.gf;
        return x.ranking - y.ranking;
    });
    return arr;
}

function simularGrupo(equiposDelGrupo) {
    const tabla = initTabla(equiposDelGrupo);
    const partidos = [];
    for (let i = 0; i < equiposDelGrupo.length; i++) {
        for (let j = i + 1; j < equiposDelGrupo.length; j++) {
            const A = equiposDelGrupo[i];
            const B = equiposDelGrupo[j];
            const { golesA, golesB } = simularPartidoConMarcador(A, B);
            aplicarResultado(tabla, A, B, golesA, golesB);
            partidos.push({ local: A.nombre, visitante: B.nombre, golesLocal: golesA, golesVisitante: golesB });
        }
    }
    const tablaOrdenada = ordenarTabla(tabla);
    return { tabla: tablaOrdenada, partidos, clasificados: [tablaOrdenada[0], tablaOrdenada[1]] };
}

function simularFaseDeGrupos(grupos) {
    const resultadosPorGrupo = {};
    const primerosYSegundos = [];
    const terceros = [];
    for (const grupo of Object.keys(grupos)) {
        const res = simularGrupo(grupos[grupo]);
        resultadosPorGrupo[grupo] = res;
        primerosYSegundos.push({ grupo, ...res.tabla[0], posicion: 1 });
        primerosYSegundos.push({ grupo, ...res.tabla[1], posicion: 2 });
        terceros.push({ grupo, ...res.tabla[2], posicion: 3 });
    }
    terceros.sort((a, b) => {
        if (b.puntos !== a.puntos) return b.puntos - a.puntos;
        if (b.dg !== a.dg) return b.dg - a.dg;
        if (b.gf !== a.gf) return b.gf - a.gf;
        return a.ranking - b.ranking;
    });
    const mejoresTerceros = terceros.slice(0, 8);
    return { resultadosPorGrupo, clasificados: [...primerosYSegundos, ...mejoresTerceros], mejoresTerceros };
}

function simularGruposSeleccionados(grupos, gruposSolicitados) {
    const resultadosPorGrupo = {};
    const clasificados = [];
    gruposSolicitados.forEach((grupo) => {
        if (grupos[grupo]) {
            const res = simularGrupo(grupos[grupo]);
            resultadosPorGrupo[grupo] = res;
            clasificados.push({ grupo, ...res.clasificados[0], posicion: 1 });
            clasificados.push({ grupo, ...res.clasificados[1], posicion: 2 });
        }
    });
    return { resultadosPorGrupo, clasificados };
}

function ordenarPorFuerzaAsc(arr) {
    return [...arr].sort((a, b) => rankingAjustado(a) - rankingAjustado(b));
}

function ordenarPorFuerzaDesc(arr) {
    return [...arr].sort((a, b) => rankingAjustado(b) - rankingAjustado(a));
}

function sacarRival(pool, equipoBase, preferirPeor = false) {
    if (pool.length === 0) return null;
    const candidatos = preferirPeor ? ordenarPorFuerzaDesc(pool) : ordenarPorFuerzaAsc(pool);
    let rival = candidatos.find((r) => r.grupo !== equipoBase.grupo);
    if (!rival) rival = candidatos[0];
    const idx = pool.findIndex((x) => x.nombre === rival.nombre && x.grupo === rival.grupo && x.posicion === rival.posicion);
    if (idx >= 0) pool.splice(idx, 1);
    return rival;
}

function generarCrucesDieciseisavos(clasificados) {
    const primeros = ordenarPorFuerzaAsc(clasificados.filter((x) => x.posicion === 1));
    const segundos = ordenarlosSegundos(clasificados.filter((x) => x.posicion === 2));
    const terceros = ordenarPorFuerzaDesc(clasificados.filter((x) => x.posicion === 3));
    const cruces = [];
    const primerosParaTerceros = primeros.slice(0, 8);
    const primerosRestantes = primeros.slice(8);
    for (const primero of primerosParaTerceros) {
        const rival = sacarRival(terceros, primero, true);
        if (rival) cruces.push({ equipoA: primero, equipoB: rival });
    }
    for (const primero of primerosRestantes) {
        const rival = sacarRival(segundos, primero, true);
        if (rival) cruces.push({ equipoA: primero, equipoB: rival });
    }
    const segundosRestantes = ordenarPorFuerzaAsc(segundos);
    while (segundosRestantes.length >= 2) {
        const a = segundosRestantes.shift();
        let idx = segundosRestantes.findIndex((x) => x.grupo !== a.grupo);
        if (idx === -1) idx = segundosRestantes.length - 1;
        const b = segundosRestantes.splice(idx, 1)[0];
        cruces.push({ equipoA: a, equipoB: b });
    }
    return cruces;
}

function ordenarlosSegundos(segundos) {
    return [...segundos].sort((a, b) => rankingAjustado(b) - rankingAjustado(a));
}

module.exports = {
    obtenerEquiposPorGrupo,
    simularPartido,
    simularPartidoEliminatoria,
    simularFaseDeGrupos,
    simularGrupo,
    simularGruposSeleccionados,
    generarCrucesDieciseisavos,
};