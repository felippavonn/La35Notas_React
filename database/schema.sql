-- Base de datos: gestion_notas
-- PostgreSQL 18+
-- Modelo simplificado y funcional para el proyecto escolar.

CREATE TABLE IF NOT EXISTS turno (
    id_turno SERIAL PRIMARY KEY,
    jornada VARCHAR(30) NOT NULL,
    hora_inicio TIME,
    hora_fin TIME,
    entrada_prehora TIME,
    salida_poshora TIME
);

CREATE TABLE IF NOT EXISTS domicilio (
    id_domicilio SERIAL PRIMARY KEY,
    calle VARCHAR(100) NOT NULL,
    numero_calle VARCHAR(10),
    departamento VARCHAR(50),
    localidad VARCHAR(80) NOT NULL
);

CREATE TABLE IF NOT EXISTS ciclo_lectivo (
    id_ciclo_lectivo SERIAL PRIMARY KEY,
    anio INTEGER NOT NULL UNIQUE CHECK (anio BETWEEN 1900 AND 2200)
);

CREATE TABLE IF NOT EXISTS especialidad (
    id_especialidad SERIAL PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS curso (
    id_curso SERIAL PRIMARY KEY,
    anio INTEGER NOT NULL CHECK (anio BETWEEN 1 AND 6),
    division VARCHAR(10) NOT NULL,
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
    id_especialidad INTEGER NOT NULL REFERENCES especialidad(id_especialidad),
    UNIQUE (id_curso, id_ciclo_lectivo)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_curso_anio_especialidad_ciclo
    ON curso(anio, id_especialidad, id_ciclo_lectivo);

CREATE TABLE IF NOT EXISTS curso_turno (
    id_curso INTEGER PRIMARY KEY REFERENCES curso(id_curso) ON DELETE CASCADE,
    id_turno INTEGER REFERENCES turno(id_turno) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS materia (
    codigo VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    carga_horaria_semanal INTEGER
);

CREATE TABLE IF NOT EXISTS profesor (
    dni VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    apellido VARCHAR(80) NOT NULL,
    email VARCHAR(150),
    telefono VARCHAR(30),
    id_domicilio INTEGER REFERENCES domicilio(id_domicilio)
);

CREATE TABLE IF NOT EXISTS alumno (
    dni VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    apellido VARCHAR(80) NOT NULL,
    fecha_nacimiento DATE,
    genero VARCHAR(30),
    nacionalidad VARCHAR(60),
    email VARCHAR(150),
    estado VARCHAR(30) NOT NULL DEFAULT 'Activo'
        CHECK (estado IN ('Activo','Egresado','Baja','Suspendido','Transferido','No corresponde')),
    id_domicilio INTEGER REFERENCES domicilio(id_domicilio)
);

CREATE TABLE IF NOT EXISTS alumno_curso (
    dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno(dni) ON DELETE CASCADE,
    id_curso INTEGER NOT NULL REFERENCES curso(id_curso),
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
    fecha_inscripcion DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_baja DATE,
    PRIMARY KEY (dni_alumno, id_curso, id_ciclo_lectivo),
    FOREIGN KEY (id_curso, id_ciclo_lectivo)
        REFERENCES curso(id_curso, id_ciclo_lectivo),
    CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_inscripcion)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alumno_curso_vigente
    ON alumno_curso(dni_alumno, id_ciclo_lectivo)
    WHERE fecha_baja IS NULL;

CREATE TABLE IF NOT EXISTS adulto_responsable (
    dni VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    apellido VARCHAR(80) NOT NULL,
    telefono VARCHAR(30),
    email VARCHAR(150)
);

CREATE TABLE IF NOT EXISTS responsables_alumnos (
    dni_responsable VARCHAR(20) REFERENCES adulto_responsable(dni) ON DELETE CASCADE,
    dni_alumno VARCHAR(20) REFERENCES alumno(dni) ON DELETE CASCADE,
    PRIMARY KEY (dni_responsable, dni_alumno)
);

CREATE TABLE IF NOT EXISTS rol (
    id_rol SERIAL PRIMARY KEY,
    nombre VARCHAR(40) UNIQUE NOT NULL,
    descripcion TEXT
);

CREATE TABLE IF NOT EXISTS usuario (
    id_usuario SERIAL PRIMARY KEY,
    nombre_usuario VARCHAR(80) UNIQUE NOT NULL,
    contrasenia VARCHAR(255) NOT NULL,
    ultimo_acceso TIMESTAMP,
    estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
    dni_alumno VARCHAR(20) UNIQUE REFERENCES alumno(dni),
    dni_profesor VARCHAR(20) UNIQUE REFERENCES profesor(dni),
    id_rol INTEGER REFERENCES rol(id_rol),
    CHECK (
        (dni_alumno IS NOT NULL AND dni_profesor IS NULL)
        OR
        (dni_alumno IS NULL AND dni_profesor IS NOT NULL)
        OR
        (dni_alumno IS NULL AND dni_profesor IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS profesor_rol (
    dni_profesor VARCHAR(20) REFERENCES profesor(dni) ON DELETE CASCADE,
    id_rol INTEGER REFERENCES rol(id_rol) ON DELETE CASCADE,
    PRIMARY KEY (dni_profesor, id_rol)
);

CREATE TABLE IF NOT EXISTS profesor_curso_materia (
    dni_profesor VARCHAR(20) REFERENCES profesor(dni) ON DELETE CASCADE,
    id_curso INTEGER NOT NULL,
    codigo_materia VARCHAR(20) REFERENCES materia(codigo) ON DELETE CASCADE,
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
    PRIMARY KEY (dni_profesor, id_curso, codigo_materia, id_ciclo_lectivo),
    FOREIGN KEY (id_curso, id_ciclo_lectivo)
        REFERENCES curso(id_curso, id_ciclo_lectivo) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nota (
    id_nota SERIAL PRIMARY KEY,
    calificacion NUMERIC(4,2) CHECK (calificacion BETWEEN 1 AND 10),
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo_evaluacion VARCHAR(30) NOT NULL,
    observacion TEXT,
    dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno(dni) ON DELETE CASCADE,
    id_curso INTEGER NOT NULL,
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
    codigo_materia VARCHAR(20) NOT NULL REFERENCES materia(codigo),
    dni_profesor VARCHAR(20) REFERENCES profesor(dni),
    FOREIGN KEY (dni_alumno, id_curso, id_ciclo_lectivo)
        REFERENCES alumno_curso(dni_alumno, id_curso, id_ciclo_lectivo),
    UNIQUE (dni_alumno, codigo_materia, tipo_evaluacion, id_ciclo_lectivo)
);

CREATE INDEX IF NOT EXISTS idx_alumno_curso_ciclo ON alumno_curso(id_ciclo_lectivo, id_curso);
CREATE INDEX IF NOT EXISTS idx_nota_alumno ON nota(dni_alumno);
CREATE INDEX IF NOT EXISTS idx_nota_materia ON nota(codigo_materia);

-- Datos mínimos para poder probar la página.
-- Turnos
INSERT INTO turno (jornada, hora_inicio, hora_fin, entrada_prehora, salida_poshora)
SELECT 'Mañana', '07:40', '12:10', '07:10', '12:50'
WHERE NOT EXISTS (SELECT 1 FROM turno WHERE jornada='Mañana');

INSERT INTO turno (jornada, hora_inicio, hora_fin, entrada_prehora, salida_poshora)
SELECT 'Tarde', '13:30', '18:00', '12:50', '18:40'
WHERE NOT EXISTS (SELECT 2 FROM turno WHERE jornada='Tarde');

INSERT INTO turno (jornada, hora_inicio, hora_fin, entrada_prehora, salida_poshora)
SELECT 'Noche', '18:10', '22:40', '17:30', '23:20'
WHERE NOT EXISTS (SELECT 3 FROM turno WHERE jornada='Noche');

INSERT INTO ciclo_lectivo (anio)
VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER)
ON CONFLICT (anio) DO NOTHING;

INSERT INTO especialidad (nombre)
VALUES ('Automotores'), ('Computación')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO curso (anio, division, id_ciclo_lectivo, id_especialidad)
SELECT grado.anio,
       divisiones.division,
       cl.id_ciclo_lectivo,
    e.id_especialidad
FROM generate_series(1, 6) AS grado(anio)
CROSS JOIN LATERAL (
    SELECT id_ciclo_lectivo
    FROM ciclo_lectivo
    WHERE anio=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
) cl
CROSS JOIN (VALUES ('1', 'Automotores'), ('1', 'Computación')) AS divisiones(division, especialidad)
JOIN especialidad e ON e.nombre=divisiones.especialidad
ON CONFLICT (anio, id_especialidad, id_ciclo_lectivo) DO NOTHING;

UPDATE curso_turno ct
SET id_turno=(SELECT id_turno FROM turno WHERE jornada='Mañana' ORDER BY id_turno LIMIT 1)
FROM curso c
JOIN especialidad e ON e.id_especialidad=c.id_especialidad
JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=c.id_ciclo_lectivo
WHERE ct.id_curso=c.id_curso
    AND c.anio=6 AND e.nombre='Computación'
    AND cl.anio=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;

INSERT INTO curso_turno (id_curso, id_turno)
SELECT c.id_curso,
             CASE WHEN c.anio=6 AND e.nombre='Computación'
                 THEN mañana.id_turno ELSE aleatorio.id_turno END
FROM curso c
JOIN especialidad e ON e.id_especialidad=c.id_especialidad
JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=c.id_ciclo_lectivo
CROSS JOIN LATERAL (
        SELECT id_turno FROM turno ORDER BY random() LIMIT 1
) aleatorio
CROSS JOIN LATERAL (
        SELECT id_turno FROM turno WHERE jornada='Mañana' ORDER BY id_turno LIMIT 1
) mañana
WHERE cl.anio=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
ON CONFLICT (id_curso) DO NOTHING;

INSERT INTO materia (codigo, nombre, descripcion, carga_horaria_semanal)
VALUES ('PPP', 'Prácticas Profesionalizantes', 'Materia de prácticas profesionalizantes', 6)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO profesor (dni, nombre, apellido, email)
VALUES ('31928371', 'Juan', 'Moya', 'juan.moya@escuela.edu.ar')
ON CONFLICT (dni) DO NOTHING;

INSERT INTO profesor (dni, nombre, apellido, email)
VALUES ('32651658', 'Aaron', 'Serrano', 'aaron.serrano@escuela.edu.ar')
ON CONFLICT (dni) DO NOTHING;

INSERT INTO alumno (dni, nombre, apellido, email, estado)
VALUES ('96103383', 'Luis', 'Rodriguez', 'luis.rodriguez@escuela.edu.ar', 'Activo')
ON CONFLICT (dni) DO NOTHING;

INSERT INTO alumno_curso (dni_alumno, id_curso, id_ciclo_lectivo)
SELECT '96103383', c.id_curso, cl.id_ciclo_lectivo
FROM curso c
JOIN especialidad e ON e.id_especialidad=c.id_especialidad
CROSS JOIN ciclo_lectivo cl
WHERE c.anio=6 AND c.division='1' AND e.nombre='Automotores'
    AND cl.anio=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
ON CONFLICT DO NOTHING;

INSERT INTO profesor_curso_materia (dni_profesor, id_curso, codigo_materia, id_ciclo_lectivo)
SELECT '31928371', c.id_curso, 'PPP', cl.id_ciclo_lectivo
FROM curso c
JOIN especialidad e ON e.id_especialidad=c.id_especialidad
CROSS JOIN ciclo_lectivo cl
WHERE c.anio=6 AND c.division='1' AND e.nombre='Automotores'
    AND cl.anio=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
ON CONFLICT DO NOTHING;

INSERT INTO profesor_curso_materia (dni_profesor, id_curso, codigo_materia, id_ciclo_lectivo)
SELECT '32651658', c.id_curso, 'PPP', cl.id_ciclo_lectivo
FROM curso c
JOIN especialidad e ON e.id_especialidad=c.id_especialidad
CROSS JOIN ciclo_lectivo cl
WHERE c.anio=6 AND c.division='1' AND e.nombre='Automotores'
    AND cl.anio=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
ON CONFLICT DO NOTHING;

INSERT INTO nota (calificacion, tipo_evaluacion, dni_alumno, id_curso, id_ciclo_lectivo, codigo_materia, dni_profesor, observacion)
SELECT 9, 'BIMESTRE_1', ac.dni_alumno, ac.id_curso, ac.id_ciclo_lectivo, 'PPP', '31928371', 'Nota de prueba'
FROM alumno_curso ac JOIN ciclo_lectivo cl USING (id_ciclo_lectivo)
WHERE ac.dni_alumno='96103383'
    AND cl.anio=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
    AND ac.id_curso=(
        SELECT c.id_curso
        FROM curso c
        JOIN especialidad e ON e.id_especialidad=c.id_especialidad
        WHERE c.anio=6 AND c.division='1' AND e.nombre='Automotores'
        LIMIT 1
    )
ON CONFLICT (dni_alumno, codigo_materia, tipo_evaluacion, id_ciclo_lectivo) DO NOTHING;

INSERT INTO nota (calificacion, tipo_evaluacion, dni_alumno, id_curso, id_ciclo_lectivo, codigo_materia, dni_profesor)
SELECT 9, 'BIMESTRE_2', ac.dni_alumno, ac.id_curso, ac.id_ciclo_lectivo, 'PPP', '31928371'
FROM alumno_curso ac JOIN ciclo_lectivo cl USING (id_ciclo_lectivo)
WHERE ac.dni_alumno='96103383'
    AND cl.anio=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
    AND ac.id_curso=(
        SELECT c.id_curso
        FROM curso c
        JOIN especialidad e ON e.id_especialidad=c.id_especialidad
        WHERE c.anio=6 AND c.division='1' AND e.nombre='Automotores'
        LIMIT 1
    )
ON CONFLICT (dni_alumno, codigo_materia, tipo_evaluacion, id_ciclo_lectivo) DO NOTHING;
