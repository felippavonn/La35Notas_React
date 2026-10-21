const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'database/schema.sql'),
        'utf8'
    );
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'database/migrate-cycle-lectivo.sql'),
        'utf8'
    );
    const specialtyMigration = fs.readFileSync(
        path.join(__dirname, '..', 'database/migrate-especialidades.sql'),
        'utf8'
    );

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'true'
            ? { rejectUnauthorized: false }
            : undefined
    });

    try {
        await pool.query(migration);
        await pool.query(specialtyMigration);
        await pool.query(sql);
        console.log('Esquema de la base de datos aplicado correctamente.');
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error('Error al inicializar la base de datos:', error);
    process.exit(1);
});
