const pool = require("./database/db");
const {
    obtenerEquiposPorGrupo,
    simularPartido,
    simularFaseDeGrupos,
} = require("./services/simulator");

async function main() {
    const grupos = await obtenerEquiposPorGrupo();

    console.log("=== Grupos cargados desde DB ===");
    for (const grupo of Object.keys(grupos)) {
        console.log(`\nGrupo ${grupo}`);
        grupos[grupo].forEach((e) =>
            console.log(`- ${e.nombre} (Ranking ${e.ranking})`)
        );
    }

    // ====== FASE DE GRUPOS COMPLETA ======
    const { resultadosPorGrupo, clasificados } = simularFaseDeGrupos(grupos);

    console.log("\n=== TABLAS POR GRUPO ===");
    for (const g of Object.keys(resultadosPorGrupo)) {
        console.log(`\nGrupo ${g}`);
        resultadosPorGrupo[g].tabla.forEach((t, idx) => {
            console.log(
                `${idx + 1}. ${t.nombre} | Pts:${t.puntos} GF:${t.gf} GC:${t.gc} DG:${t.dg} (R:${t.ranking})`
            );
        });
    }

    console.log("\n=== CLASIFICADOS (Top 2 por grupo) ===");
    clasificados
        .sort((a, b) => a.grupo.localeCompare(b.grupo) || a.posicion - b.posicion)
        .forEach((c) => console.log(`Grupo ${c.grupo} (${c.posicion}): ${c.nombre}`));

    await pool.end();
}

main().catch((err) => console.error(err));