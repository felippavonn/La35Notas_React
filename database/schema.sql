-- Base de datos: gestion_notas
-- PostgreSQL 18+
-- Modelo simplificado y funcional para el proyecto escolar.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.curso') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='curso'
      AND column_name='ciclo_lectivo'
  ) THEN
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS ciclo_lectivo (
    id_ciclo_lectivo SERIAL PRIMARY KEY,
    anio INTEGER NOT NULL UNIQUE CHECK (anio BETWEEN 1900 AND 2200)
  );

  INSERT INTO ciclo_lectivo (anio)
  SELECT DISTINCT ciclo_lectivo FROM curso
  ON CONFLICT (anio) DO NOTHING;

  ALTER TABLE curso
    ADD COLUMN id_ciclo_lectivo INTEGER REFERENCES ciclo_lectivo(id_ciclo_lectivo);

  UPDATE curso c
  SET id_ciclo_lectivo=cl.id_ciclo_lectivo
  FROM ciclo_lectivo cl
  WHERE cl.anio=c.ciclo_lectivo;

  ALTER TABLE curso ALTER COLUMN id_ciclo_lectivo SET NOT NULL;
  ALTER TABLE curso DROP CONSTRAINT IF EXISTS curso_anio_division_ciclo_lectivo_key;
  ALTER TABLE curso ADD CONSTRAINT curso_anio_division_ciclo_key
    UNIQUE (anio, division, id_ciclo_lectivo);
  ALTER TABLE curso ADD CONSTRAINT curso_id_curso_ciclo_key
    UNIQUE (id_curso, id_ciclo_lectivo);

  CREATE TABLE alumno_curso (
    dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno(dni) ON DELETE CASCADE,
    id_curso INTEGER NOT NULL REFERENCES curso(id_curso),
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
    fecha_inscripcion DATE NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (dni_alumno, id_curso, id_ciclo_lectivo),
    FOREIGN KEY (id_curso, id_ciclo_lectivo)
      REFERENCES curso(id_curso, id_ciclo_lectivo)
  );

  ALTER TABLE alumno_curso ADD COLUMN fecha_baja DATE;
  ALTER TABLE alumno_curso
    ADD CONSTRAINT alumno_curso_fechas_check
    CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_inscripcion);

  CREATE UNIQUE INDEX idx_alumno_curso_vigente
    ON alumno_curso(dni_alumno, id_ciclo_lectivo)
    WHERE fecha_baja IS NULL;

  INSERT INTO alumno_curso (dni_alumno, id_curso, id_ciclo_lectivo)
  SELECT a.dni, c.id_curso, c.id_ciclo_lectivo
  FROM alumno a
  JOIN curso c ON c.id_curso=a.id_curso
  ON CONFLICT DO NOTHING;

  ALTER TABLE profesor_curso_materia
    ADD COLUMN id_ciclo_lectivo INTEGER REFERENCES ciclo_lectivo(id_ciclo_lectivo);

  UPDATE profesor_curso_materia pcm
  SET id_ciclo_lectivo=c.id_ciclo_lectivo
  FROM curso c
  WHERE c.id_curso=pcm.id_curso;

  ALTER TABLE profesor_curso_materia ALTER COLUMN id_ciclo_lectivo SET NOT NULL;
  ALTER TABLE profesor_curso_materia
    DROP CONSTRAINT profesor_curso_materia_pkey;
  ALTER TABLE profesor_curso_materia
    ADD CONSTRAINT profesor_curso_materia_pkey
    PRIMARY KEY (dni_profesor, id_curso, codigo_materia, id_ciclo_lectivo);
  ALTER TABLE profesor_curso_materia
    ADD CONSTRAINT profesor_curso_materia_curso_ciclo_fkey
    FOREIGN KEY (id_curso, id_ciclo_lectivo)
    REFERENCES curso(id_curso, id_ciclo_lectivo) ON DELETE CASCADE;

  ALTER TABLE nota ADD COLUMN id_curso INTEGER;
  ALTER TABLE nota
    ADD COLUMN id_ciclo_lectivo INTEGER REFERENCES ciclo_lectivo(id_ciclo_lectivo);

  UPDATE nota n
  SET id_curso=ac.id_curso,
      id_ciclo_lectivo=ac.id_ciclo_lectivo
  FROM alumno_curso ac
  WHERE ac.dni_alumno=n.dni_alumno;

  ALTER TABLE nota
    DROP CONSTRAINT IF EXISTS nota_dni_alumno_codigo_materia_tipo_evaluacion_key;
  ALTER TABLE nota
    ADD CONSTRAINT nota_alumno_curso_ciclo_fkey
    FOREIGN KEY (dni_alumno, id_curso, id_ciclo_lectivo)
    REFERENCES alumno_curso(dni_alumno, id_curso, id_ciclo_lectivo);
  ALTER TABLE nota
    ADD CONSTRAINT nota_alumno_materia_evaluacion_ciclo_key
    UNIQUE (dni_alumno, codigo_materia, tipo_evaluacion, id_ciclo_lectivo);

  DROP INDEX IF EXISTS idx_alumno_curso;
  ALTER TABLE alumno DROP COLUMN id_curso;
  ALTER TABLE curso DROP COLUMN ciclo_lectivo;

  CREATE INDEX IF NOT EXISTS idx_alumno_curso_ciclo
    ON alumno_curso(id_ciclo_lectivo, id_curso);
  CREATE INDEX IF NOT EXISTS idx_nota_ciclo ON nota(id_ciclo_lectivo);
END $$;

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS especialidad (
  id_especialidad SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE
);

INSERT INTO
  especialidad (nombre)
VALUES
  ('Automotores'),
  ('Computación')
ON CONFLICT (nombre) DO NOTHING;

DO $$
DECLARE
  had_course_turnos BOOLEAN := to_regclass('public.curso_turno') IS NOT NULL;
  migration_applied BOOLEAN;
BEGIN
  IF to_regclass('public.app_schema_migration') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM app_schema_migration WHERE nombre=$1)'
      INTO migration_applied
      USING 'especialidades_normalizadas_v1';
    IF migration_applied THEN
      RETURN;
    END IF;
  END IF;

  IF to_regclass('public.curso') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO turno (jornada)
  SELECT 'Mañana'
  WHERE NOT EXISTS (SELECT 1 FROM turno WHERE jornada='Mañana');
  INSERT INTO turno (jornada)
  SELECT 'Tarde'
  WHERE NOT EXISTS (SELECT 1 FROM turno WHERE jornada='Tarde');
  INSERT INTO turno (jornada)
  SELECT 'Noche'
  WHERE NOT EXISTS (SELECT 1 FROM turno WHERE jornada='Noche');

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='curso' AND column_name='especialidad'
  ) THEN
    EXECUTE $sql$
      INSERT INTO especialidad (nombre)
      SELECT DISTINCT BTRIM(especialidad)
      FROM curso
      WHERE NULLIF(BTRIM(especialidad), '') IS NOT NULL
      ON CONFLICT (nombre) DO NOTHING
    $sql$;
  END IF;

  ALTER TABLE curso
    ADD COLUMN IF NOT EXISTS id_especialidad INTEGER REFERENCES especialidad(id_especialidad);

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='curso' AND column_name='especialidad'
  ) THEN
    EXECUTE $sql$
      UPDATE curso c
      SET id_especialidad=e.id_especialidad
      FROM especialidad e
      WHERE e.nombre=NULLIF(BTRIM(c.especialidad), '')
        AND c.id_especialidad IS NULL
    $sql$;
  END IF;

  UPDATE curso
  SET id_especialidad=(SELECT id_especialidad FROM especialidad WHERE nombre='Automotores')
  WHERE id_especialidad IS NULL;

  ALTER TABLE curso ALTER COLUMN id_especialidad SET NOT NULL;
  ALTER TABLE curso DROP COLUMN IF EXISTS especialidad;
  ALTER TABLE curso DROP CONSTRAINT IF EXISTS curso_anio_check;
  ALTER TABLE curso ADD CONSTRAINT curso_anio_check CHECK (anio BETWEEN 1 AND 6);

  ALTER TABLE nota DROP CONSTRAINT IF EXISTS nota_alumno_curso_ciclo_fkey;
  DROP INDEX IF EXISTS idx_alumno_curso_vigente;
  DROP INDEX IF EXISTS idx_curso_anio_division_ciclo_turno;
  ALTER TABLE curso DROP CONSTRAINT IF EXISTS curso_anio_division_ciclo_key;
  ALTER TABLE curso DROP CONSTRAINT IF EXISTS curso_anio_division_ciclo_lectivo_key;
  ALTER TABLE curso DROP CONSTRAINT IF EXISTS curso_anio_division_id_ciclo_lectivo_key;
  ALTER TABLE curso DROP CONSTRAINT IF EXISTS curso_anio_division_id_ciclo_lectivo_id_turno_key;

  CREATE TABLE IF NOT EXISTS curso_turno (
    id_curso INTEGER PRIMARY KEY REFERENCES curso(id_curso) ON DELETE CASCADE,
    id_turno INTEGER REFERENCES turno(id_turno) ON DELETE CASCADE
  );

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='curso' AND column_name='id_turno'
  ) THEN
    EXECUTE $sql$
      INSERT INTO curso_turno (id_curso, id_turno)
      SELECT id_curso, id_turno FROM curso WHERE id_turno IS NOT NULL
      ON CONFLICT DO NOTHING
    $sql$;
  ELSIF NOT had_course_turnos THEN
    INSERT INTO curso_turno (id_curso, id_turno)
    SELECT c.id_curso, t.id_turno
    FROM curso c CROSS JOIN turno t
    ON CONFLICT DO NOTHING;
  END IF;

  CREATE TEMP TABLE curso_merge_map ON COMMIT DROP AS
    SELECT c.id_curso,
           MIN(c.id_curso) OVER (
             PARTITION BY c.anio, c.id_especialidad, c.id_ciclo_lectivo
           ) AS id_curso_conservado
    FROM curso c;

  INSERT INTO profesor_curso_materia
    (dni_profesor, id_curso, codigo_materia, id_ciclo_lectivo)
  SELECT DISTINCT pcm.dni_profesor, cm.id_curso_conservado,
         pcm.codigo_materia, pcm.id_ciclo_lectivo
  FROM profesor_curso_materia pcm
  JOIN curso_merge_map cm ON cm.id_curso=pcm.id_curso
  WHERE cm.id_curso<>cm.id_curso_conservado
  ON CONFLICT DO NOTHING;

  INSERT INTO curso_turno (id_curso, id_turno)
  SELECT DISTINCT cm.id_curso_conservado, ct.id_turno
  FROM curso_turno ct
  JOIN curso_merge_map cm ON cm.id_curso=ct.id_curso
  WHERE cm.id_curso<>cm.id_curso_conservado
  ON CONFLICT DO NOTHING;

  DELETE FROM profesor_curso_materia pcm
  USING curso_merge_map cm
  WHERE pcm.id_curso=cm.id_curso
    AND cm.id_curso<>cm.id_curso_conservado;

  CREATE TEMP TABLE alumno_curso_merge ON COMMIT DROP AS
    SELECT ac.dni_alumno,
           cm.id_curso_conservado AS id_curso,
           ac.id_ciclo_lectivo,
           MIN(ac.fecha_inscripcion) AS fecha_inscripcion,
           CASE WHEN BOOL_OR(ac.fecha_baja IS NULL)
             THEN NULL ELSE MAX(ac.fecha_baja) END AS fecha_baja
    FROM alumno_curso ac
    JOIN curso_merge_map cm ON cm.id_curso=ac.id_curso
    GROUP BY ac.dni_alumno, cm.id_curso_conservado, ac.id_ciclo_lectivo;

  DELETE FROM alumno_curso;
  INSERT INTO alumno_curso
    (dni_alumno, id_curso, id_ciclo_lectivo, fecha_inscripcion, fecha_baja)
  SELECT dni_alumno, id_curso, id_ciclo_lectivo, fecha_inscripcion, fecha_baja
  FROM alumno_curso_merge;

  UPDATE nota n
  SET id_curso=cm.id_curso_conservado
  FROM curso_merge_map cm
  WHERE n.id_curso=cm.id_curso
    AND cm.id_curso<>cm.id_curso_conservado;

  ALTER TABLE nota
    ADD CONSTRAINT nota_alumno_curso_ciclo_fkey
    FOREIGN KEY (dni_alumno, id_curso, id_ciclo_lectivo)
    REFERENCES alumno_curso(dni_alumno, id_curso, id_ciclo_lectivo);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_alumno_curso_vigente
    ON alumno_curso(dni_alumno, id_ciclo_lectivo)
    WHERE fecha_baja IS NULL;

  DELETE FROM curso c
  USING curso_merge_map cm
  WHERE c.id_curso=cm.id_curso
    AND cm.id_curso<>cm.id_curso_conservado;

  UPDATE curso c
  SET division='1'
  FROM especialidad e
  WHERE e.id_especialidad=c.id_especialidad
    AND e.nombre IN ('Automotores', 'Computación');

  CREATE TEMP TABLE curso_turno_seleccionado (
    id_curso INTEGER PRIMARY KEY,
    id_turno INTEGER NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO curso_turno_seleccionado (id_curso, id_turno)
  SELECT DISTINCT ON (ct.id_curso) ct.id_curso, ct.id_turno
  FROM curso_turno ct
  ORDER BY ct.id_curso, random();

  INSERT INTO curso_turno_seleccionado (id_curso, id_turno)
  SELECT c.id_curso, aleatorio.id_turno
  FROM curso c
  CROSS JOIN LATERAL (
    SELECT id_turno FROM turno ORDER BY random() LIMIT 1
  ) aleatorio
  WHERE NOT EXISTS (
    SELECT 1 FROM curso_turno_seleccionado selected
    WHERE selected.id_curso=c.id_curso
  );

  DELETE FROM curso_turno_seleccionado selected
  USING curso c, especialidad e
  WHERE selected.id_curso=c.id_curso
    AND e.id_especialidad=c.id_especialidad
    AND c.anio=6 AND e.nombre='Computación';

  INSERT INTO curso_turno_seleccionado (id_curso, id_turno)
  SELECT c.id_curso, t.id_turno
  FROM curso c
  JOIN especialidad e ON e.id_especialidad=c.id_especialidad
  CROSS JOIN turno t
  WHERE c.anio=6 AND e.nombre='Computación' AND t.jornada='Mañana';

  DELETE FROM curso_turno;
  INSERT INTO curso_turno (id_curso, id_turno)
  SELECT id_curso, id_turno FROM curso_turno_seleccionado;

  ALTER TABLE curso_turno ALTER COLUMN id_turno DROP NOT NULL;
  ALTER TABLE curso_turno DROP CONSTRAINT IF EXISTS curso_turno_pkey;
  ALTER TABLE curso_turno ADD CONSTRAINT curso_turno_pkey PRIMARY KEY (id_curso);

  ALTER TABLE curso DROP COLUMN IF EXISTS id_turno;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_curso_anio_especialidad_ciclo
    ON curso(anio, id_especialidad, id_ciclo_lectivo);
END $$;

COMMIT;

CREATE TABLE IF NOT EXISTS turno (
  id_turno SERIAL PRIMARY KEY,
  jornada VARCHAR(30) NOT NULL
);

ALTER TABLE turno
DROP COLUMN IF EXISTS hora_inicio,
DROP COLUMN IF EXISTS hora_fin,
DROP COLUMN IF EXISTS entrada_prehora,
DROP COLUMN IF EXISTS salida_poshora;

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

INSERT INTO
  ciclo_lectivo (anio)
VALUES
  (2026)
ON CONFLICT (anio) DO NOTHING;

ALTER TABLE turno
ADD COLUMN IF NOT EXISTS id_ciclo_lectivo INTEGER REFERENCES ciclo_lectivo (id_ciclo_lectivo) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS especialidad (
  id_especialidad SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS curso (
  id_curso SERIAL PRIMARY KEY,
  anio INTEGER NOT NULL CHECK (anio BETWEEN 1 AND 6),
  division VARCHAR(10) NOT NULL,
  id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo (id_ciclo_lectivo),
  id_especialidad INTEGER REFERENCES especialidad (id_especialidad),
  UNIQUE (id_curso, id_ciclo_lectivo)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_curso_anio_especialidad_ciclo ON curso (anio, id_especialidad, id_ciclo_lectivo);

ALTER TABLE curso
ALTER COLUMN id_especialidad DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_curso_basico_anio_division_ciclo
ON curso (anio, division, id_ciclo_lectivo)
WHERE anio IN (1, 2) AND id_especialidad IS NULL;

CREATE TABLE IF NOT EXISTS curso_turno (
  id_curso INTEGER PRIMARY KEY REFERENCES curso (id_curso) ON DELETE CASCADE,
  id_turno INTEGER REFERENCES turno (id_turno) ON DELETE CASCADE
);

DELETE FROM curso_turno ct
USING turno t
WHERE ct.id_turno=t.id_turno
  AND t.jornada NOT IN ('Mañana', 'Tarde', 'Noche');

DELETE FROM turno
WHERE jornada NOT IN ('Mañana', 'Tarde', 'Noche');

WITH turnos_canonicos AS (
  SELECT jornada, MIN(id_turno) AS id_turno
  FROM turno
  GROUP BY jornada
)
UPDATE curso_turno ct
SET id_turno=canonicos.id_turno
FROM turno t
JOIN turnos_canonicos canonicos
  ON canonicos.jornada=t.jornada
WHERE ct.id_turno=t.id_turno
  AND ct.id_turno<>canonicos.id_turno;

DELETE FROM turno t
USING (
  SELECT jornada, MIN(id_turno) AS id_turno
  FROM turno
  GROUP BY jornada
) canonicos
WHERE t.jornada=canonicos.jornada
  AND t.id_turno<>canonicos.id_turno;

DROP TRIGGER IF EXISTS ciclo_lectivo_crear_turnos ON ciclo_lectivo;
DROP FUNCTION IF EXISTS crear_turnos_ciclo_lectivo();
DROP INDEX IF EXISTS idx_turno_ciclo_jornada;

ALTER TABLE turno
DROP COLUMN IF EXISTS id_ciclo_lectivo;

ALTER TABLE turno
DROP CONSTRAINT IF EXISTS turno_jornada_check;

ALTER TABLE turno
ADD CONSTRAINT turno_jornada_check CHECK (
  jornada IN ('Mañana', 'Tarde', 'Noche')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_turno_jornada
ON turno (jornada);

INSERT INTO turno (jornada)
VALUES ('Mañana'), ('Tarde'), ('Noche')
ON CONFLICT (jornada) DO NOTHING;

CREATE TABLE IF NOT EXISTS materia (
  codigo VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS app_schema_migration (
  nombre VARCHAR(100) PRIMARY KEY,
  ejecutada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS curso_materia (
  id_curso INTEGER NOT NULL,
  codigo_materia VARCHAR(20) NOT NULL REFERENCES materia (codigo),
  id_ciclo_lectivo INTEGER NOT NULL,
  PRIMARY KEY (id_curso, codigo_materia, id_ciclo_lectivo),
  FOREIGN KEY (id_curso, id_ciclo_lectivo) REFERENCES curso (id_curso, id_ciclo_lectivo) ON DELETE CASCADE
);

ALTER TABLE materia
DROP COLUMN IF EXISTS carga_horaria_semanal;

ALTER TABLE materia
DROP COLUMN IF EXISTS descripcion;

CREATE TABLE IF NOT EXISTS profesor (
  dni VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  email VARCHAR(150),
  telefono VARCHAR(30),
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo' CHECK (
    estado IN ('Activo', 'Baja')
  ),
  id_domicilio INTEGER REFERENCES domicilio (id_domicilio)
);

CREATE TABLE IF NOT EXISTS preceptor (
  dni VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  email VARCHAR(150),
  telefono VARCHAR(30),
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo'
);

ALTER TABLE preceptor
ADD COLUMN IF NOT EXISTS email VARCHAR(150);

ALTER TABLE preceptor
ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'Activo';

ALTER TABLE preceptor
DROP CONSTRAINT IF EXISTS preceptor_estado_check;

ALTER TABLE preceptor
ADD CONSTRAINT preceptor_estado_check CHECK (estado IN ('Activo', 'Baja'));

CREATE TABLE IF NOT EXISTS administrador (
  dni VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  email VARCHAR(150),
  telefono VARCHAR(30),
  cargo VARCHAR(30) CHECK (
    cargo IN ('Regente', 'Subregente')
    OR cargo IS NULL
  ),
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo'
);

ALTER TABLE administrador
ADD COLUMN IF NOT EXISTS email VARCHAR(150);

ALTER TABLE administrador
ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'Activo';

ALTER TABLE administrador
DROP CONSTRAINT IF EXISTS administrador_estado_check;

ALTER TABLE administrador
ADD CONSTRAINT administrador_estado_check CHECK (estado IN ('Activo', 'Baja'));

ALTER TABLE profesor
ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'Activo';

ALTER TABLE profesor
DROP CONSTRAINT IF EXISTS profesor_estado_check;

UPDATE profesor
SET estado='Activo'
WHERE estado IN ('Licencia', 'Suplente');

ALTER TABLE profesor
ADD CONSTRAINT profesor_estado_check CHECK (
  estado IN ('Activo', 'Baja')
);

CREATE TABLE IF NOT EXISTS alumno (
  dni VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  fecha_nacimiento DATE,
  genero VARCHAR(30),
  nacionalidad VARCHAR(60),
  email VARCHAR(150),
  estado VARCHAR(30) NOT NULL DEFAULT 'Activo' CHECK (
    estado IN (
      'Activo',
      'Egresado',
      'Baja',
      'Suspendido',
      'Transferido',
      'No corresponde'
    )
  ),
  id_domicilio INTEGER REFERENCES domicilio (id_domicilio)
);

CREATE TABLE IF NOT EXISTS alumno_curso (
  dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno (dni) ON DELETE CASCADE,
  id_curso INTEGER NOT NULL REFERENCES curso (id_curso),
  id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo (id_ciclo_lectivo),
  fecha_inscripcion DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_baja DATE,
  PRIMARY KEY (dni_alumno, id_curso, id_ciclo_lectivo),
  FOREIGN KEY (id_curso, id_ciclo_lectivo) REFERENCES curso (id_curso, id_ciclo_lectivo),
  CHECK (
    fecha_baja IS NULL
    OR fecha_baja >= fecha_inscripcion
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alumno_curso_vigente ON alumno_curso (dni_alumno, id_ciclo_lectivo)
WHERE
  fecha_baja IS NULL;

CREATE TABLE IF NOT EXISTS adulto_responsable (
  dni VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  telefono VARCHAR(30),
  email VARCHAR(150)
);

CREATE TABLE IF NOT EXISTS responsables_alumnos (
  dni_responsable VARCHAR(20) REFERENCES adulto_responsable (dni) ON DELETE CASCADE,
  dni_alumno VARCHAR(20) REFERENCES alumno (dni) ON DELETE CASCADE,
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
  dni_alumno VARCHAR(20) UNIQUE REFERENCES alumno (dni),
  dni_profesor VARCHAR(20) UNIQUE REFERENCES profesor (dni),
  dni_preceptor VARCHAR(20) UNIQUE REFERENCES preceptor (dni),
  dni_administrador VARCHAR(20) UNIQUE REFERENCES administrador (dni),
  id_rol INTEGER REFERENCES rol (id_rol),
  CHECK (
    num_nonnulls (
      dni_alumno,
      dni_profesor,
      dni_preceptor,
      dni_administrador
    ) <= 1
  )
);

ALTER TABLE usuario
ADD COLUMN IF NOT EXISTS dni_preceptor VARCHAR(20) UNIQUE REFERENCES preceptor (dni);

ALTER TABLE usuario
ADD COLUMN IF NOT EXISTS dni_administrador VARCHAR(20) UNIQUE REFERENCES administrador (dni);

ALTER TABLE usuario
DROP CONSTRAINT IF EXISTS usuario_check;

ALTER TABLE usuario
DROP CONSTRAINT IF EXISTS usuario_persona_check;

ALTER TABLE usuario
ADD CONSTRAINT usuario_persona_check CHECK (
  num_nonnulls (
    dni_alumno,
    dni_profesor,
    dni_preceptor,
    dni_administrador
  ) <= 1
);

UPDATE usuario u
SET estado=CASE WHEN a.estado='Activo' THEN 'Activo' ELSE 'Baja' END
FROM alumno a
WHERE u.dni_alumno=a.dni;

UPDATE usuario u
SET estado=CASE WHEN p.estado='Activo' THEN 'Activo' ELSE 'Baja' END
FROM profesor p
WHERE u.dni_profesor=p.dni;

UPDATE usuario u
SET estado=CASE WHEN p.estado='Activo' THEN 'Activo' ELSE 'Baja' END
FROM preceptor p
WHERE u.dni_preceptor=p.dni;

UPDATE usuario u
SET estado=CASE WHEN a.estado='Activo' THEN 'Activo' ELSE 'Baja' END
FROM administrador a
WHERE u.dni_administrador=a.dni;

CREATE TABLE IF NOT EXISTS profesor_rol (
  dni_profesor VARCHAR(20) REFERENCES profesor (dni) ON DELETE CASCADE,
  id_rol INTEGER REFERENCES rol (id_rol) ON DELETE CASCADE,
  PRIMARY KEY (dni_profesor, id_rol)
);

CREATE TABLE IF NOT EXISTS profesor_curso_materia (
  dni_profesor VARCHAR(20) REFERENCES profesor (dni) ON DELETE CASCADE,
  id_curso INTEGER NOT NULL,
  codigo_materia VARCHAR(20) REFERENCES materia (codigo) ON DELETE CASCADE,
  id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo (id_ciclo_lectivo),
  PRIMARY KEY (
    dni_profesor,
    id_curso,
    codigo_materia,
    id_ciclo_lectivo
  ),
  FOREIGN KEY (id_curso, id_ciclo_lectivo) REFERENCES curso (id_curso, id_ciclo_lectivo) ON DELETE CASCADE,
  CONSTRAINT profesor_curso_materia_curso_materia_fkey FOREIGN KEY (id_curso, codigo_materia, id_ciclo_lectivo) REFERENCES curso_materia (id_curso, codigo_materia, id_ciclo_lectivo) ON DELETE CASCADE
);

DELETE FROM profesor_curso_materia pcm
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      curso_materia cm
    WHERE
      cm.id_curso = pcm.id_curso
      AND cm.codigo_materia = pcm.codigo_materia
      AND cm.id_ciclo_lectivo = pcm.id_ciclo_lectivo
  );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='profesor_curso_materia_curso_materia_fkey'
          AND conrelid='profesor_curso_materia'::regclass
    ) THEN
        ALTER TABLE profesor_curso_materia
            ADD CONSTRAINT profesor_curso_materia_curso_materia_fkey
            FOREIGN KEY (id_curso, codigo_materia, id_ciclo_lectivo)
            REFERENCES curso_materia(id_curso, codigo_materia, id_ciclo_lectivo)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS profesor_materia (
  dni_profesor VARCHAR(20) NOT NULL REFERENCES profesor (dni) ON DELETE CASCADE,
  codigo_materia VARCHAR(20) NOT NULL REFERENCES materia (codigo) ON DELETE CASCADE,
  id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo (id_ciclo_lectivo),
  PRIMARY KEY (dni_profesor, codigo_materia, id_ciclo_lectivo)
);

INSERT INTO
  profesor_materia (dni_profesor, codigo_materia, id_ciclo_lectivo)
SELECT DISTINCT
  dni_profesor,
  codigo_materia,
  id_ciclo_lectivo
FROM
  profesor_curso_materia
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS nota (
  id_nota SERIAL PRIMARY KEY,
  calificacion NUMERIC(4, 2) CHECK (calificacion BETWEEN 1 AND 10),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo_evaluacion VARCHAR(30) NOT NULL,
  observacion TEXT,
  dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno (dni) ON DELETE CASCADE,
  id_curso INTEGER NOT NULL,
  id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo (id_ciclo_lectivo),
  codigo_materia VARCHAR(20) NOT NULL REFERENCES materia (codigo),
  dni_profesor VARCHAR(20) REFERENCES profesor (dni),
  FOREIGN KEY (dni_alumno, id_curso, id_ciclo_lectivo) REFERENCES alumno_curso (dni_alumno, id_curso, id_ciclo_lectivo),
  UNIQUE (
    dni_alumno,
    codigo_materia,
    tipo_evaluacion,
    id_ciclo_lectivo
  )
);

CREATE INDEX IF NOT EXISTS idx_alumno_curso_ciclo ON alumno_curso (id_ciclo_lectivo, id_curso);

CREATE INDEX IF NOT EXISTS idx_nota_alumno ON nota (dni_alumno);

CREATE INDEX IF NOT EXISTS idx_nota_materia ON nota (codigo_materia);

CREATE INDEX IF NOT EXISTS idx_nota_ciclo_fecha ON nota (id_ciclo_lectivo, fecha DESC, id_nota DESC);

CREATE TABLE IF NOT EXISTS nota_individual (
  id_nota_individual SERIAL PRIMARY KEY,
  dni_alumno VARCHAR(20) NOT NULL,
  id_curso INTEGER NOT NULL,
  id_ciclo_lectivo INTEGER NOT NULL,
  codigo_materia VARCHAR(20) NOT NULL REFERENCES materia (codigo),
  tipo_evaluacion VARCHAR(30) NOT NULL CHECK (
    tipo_evaluacion IN (
      'BIMESTRE_1',
      'BIMESTRE_2',
      'BIMESTRE_3',
      'BIMESTRE_4',
      'DICIEMBRE',
      'FEBRERO'
    )
  ),
  tema TEXT NOT NULL CHECK (LENGTH(TRIM(tema)) > 0),
  estado VARCHAR(20) NOT NULL CHECK (estado IN ('No realizó', 'Entregado')),
  calificacion NUMERIC(4, 2) NOT NULL CHECK (calificacion BETWEEN 1 AND 10),
  adeuda BOOLEAN,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  dni_profesor VARCHAR(20) REFERENCES profesor (dni),
  FOREIGN KEY (dni_alumno, id_curso, id_ciclo_lectivo) REFERENCES alumno_curso (dni_alumno, id_curso, id_ciclo_lectivo) ON DELETE CASCADE,
  CHECK (
    estado <> 'No realizó'
    OR calificacion = 1
  )
);

ALTER TABLE nota_individual
ADD COLUMN IF NOT EXISTS adeuda BOOLEAN;

DO $$
DECLARE
  fk RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM app_schema_migration
    WHERE nombre='cursos_sin_especialidad_primero_segundo_v1'
  ) THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE curso_basico_merge ON COMMIT DROP AS
  SELECT id_curso,
         MIN(id_curso) OVER (
           PARTITION BY anio, division, id_ciclo_lectivo
         ) AS id_curso_conservado
  FROM curso
  WHERE anio IN (1, 2);

  FOR fk IN
    SELECT conrelid::regclass AS tabla, conname
    FROM pg_constraint
    WHERE contype='f'
      AND confrelid='alumno_curso'::regclass
      AND conrelid IN ('nota'::regclass, 'nota_individual'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tabla, fk.conname);
  END LOOP;

  UPDATE nota n
  SET id_curso=m.id_curso_conservado
  FROM curso_basico_merge m
  WHERE n.id_curso=m.id_curso
    AND m.id_curso<>m.id_curso_conservado;

  UPDATE nota_individual ni
  SET id_curso=m.id_curso_conservado
  FROM curso_basico_merge m
  WHERE ni.id_curso=m.id_curso
    AND m.id_curso<>m.id_curso_conservado;

  INSERT INTO curso_materia (id_curso, codigo_materia, id_ciclo_lectivo)
  SELECT m.id_curso_conservado, cm.codigo_materia, cm.id_ciclo_lectivo
  FROM curso_materia cm
  JOIN curso_basico_merge m ON m.id_curso=cm.id_curso
  ON CONFLICT DO NOTHING;

  INSERT INTO profesor_curso_materia
    (dni_profesor, id_curso, codigo_materia, id_ciclo_lectivo)
  SELECT pcm.dni_profesor, m.id_curso_conservado,
         pcm.codigo_materia, pcm.id_ciclo_lectivo
  FROM profesor_curso_materia pcm
  JOIN curso_basico_merge m ON m.id_curso=pcm.id_curso
  ON CONFLICT DO NOTHING;

  INSERT INTO curso_turno (id_curso, id_turno)
  SELECT DISTINCT ON (m.id_curso_conservado)
         m.id_curso_conservado, ct.id_turno
  FROM curso_turno ct
  JOIN curso_basico_merge m ON m.id_curso=ct.id_curso
  WHERE m.id_curso<>m.id_curso_conservado
    AND NOT EXISTS (
      SELECT 1 FROM curso_turno existing
      WHERE existing.id_curso=m.id_curso_conservado
    )
  ORDER BY m.id_curso_conservado, m.id_curso
  ON CONFLICT (id_curso) DO NOTHING;

  CREATE TEMP TABLE alumno_curso_basico_merge ON COMMIT DROP AS
  SELECT ac.dni_alumno,
         m.id_curso_conservado AS id_curso,
         ac.id_ciclo_lectivo,
         MIN(ac.fecha_inscripcion) AS fecha_inscripcion,
         CASE WHEN BOOL_OR(ac.fecha_baja IS NULL)
           THEN NULL ELSE MAX(ac.fecha_baja) END AS fecha_baja
  FROM alumno_curso ac
  JOIN curso_basico_merge m ON m.id_curso=ac.id_curso
  GROUP BY ac.dni_alumno, m.id_curso_conservado, ac.id_ciclo_lectivo;

  DELETE FROM profesor_curso_materia pcm
  USING curso_basico_merge m
  WHERE pcm.id_curso=m.id_curso
    AND m.id_curso<>m.id_curso_conservado;

  DELETE FROM curso_materia cm
  USING curso_basico_merge m
  WHERE cm.id_curso=m.id_curso
    AND m.id_curso<>m.id_curso_conservado;

  DELETE FROM alumno_curso ac
  USING curso_basico_merge m
  WHERE ac.id_curso=m.id_curso;

  INSERT INTO alumno_curso
    (dni_alumno, id_curso, id_ciclo_lectivo, fecha_inscripcion, fecha_baja)
  SELECT dni_alumno, id_curso, id_ciclo_lectivo, fecha_inscripcion, fecha_baja
  FROM alumno_curso_basico_merge;

  DELETE FROM curso c
  USING curso_basico_merge m
  WHERE c.id_curso=m.id_curso
    AND m.id_curso<>m.id_curso_conservado;

  UPDATE curso
  SET id_especialidad=NULL
  WHERE anio IN (1, 2);

  ALTER TABLE nota
    ADD CONSTRAINT nota_alumno_curso_ciclo_fkey
    FOREIGN KEY (dni_alumno, id_curso, id_ciclo_lectivo)
    REFERENCES alumno_curso(dni_alumno, id_curso, id_ciclo_lectivo);

  ALTER TABLE nota_individual
    ADD CONSTRAINT nota_individual_alumno_curso_ciclo_fkey
    FOREIGN KEY (dni_alumno, id_curso, id_ciclo_lectivo)
    REFERENCES alumno_curso(dni_alumno, id_curso, id_ciclo_lectivo)
    ON DELETE CASCADE;

  INSERT INTO app_schema_migration (nombre)
  VALUES ('cursos_sin_especialidad_primero_segundo_v1');
END $$;

ALTER TABLE curso
DROP CONSTRAINT IF EXISTS curso_especialidad_por_anio_check;

ALTER TABLE curso
ADD CONSTRAINT curso_especialidad_por_anio_check CHECK (
  (anio IN (1, 2) AND id_especialidad IS NULL)
  OR (anio BETWEEN 3 AND 6 AND id_especialidad IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_nota_individual_contexto ON nota_individual (
  dni_alumno,
  codigo_materia,
  id_ciclo_lectivo,
  tipo_evaluacion
);

CREATE TABLE IF NOT EXISTS notificacion_alumno (
  id_notificacion SERIAL PRIMARY KEY,
  dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno (dni) ON DELETE CASCADE,
  titulo VARCHAR(150) NOT NULL,
  mensaje TEXT NOT NULL,
  fecha TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notificacion_alumno_fecha ON notificacion_alumno (dni_alumno, fecha DESC);

INSERT INTO
  especialidad (nombre)
VALUES
  ('Automotores'),
  ('Computación')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO
  materia (codigo, nombre)
VALUES
  ('MAT', 'Matemática'),
  ('LEN', 'Lengua y Literatura'),
  ('PPP', 'Prácticas Profesionalizantes'),
  ('PRED', 'Programación sobre Redes'),
  ('EF', 'Educación Física'),
  ('ING', 'Inglés'),
  ('HIS', 'Historia'),
  ('DDS', 'Desarrollo de Sistemas'),
  ('ASR', 'Administración de Sistemas y Redes'),
  ('RED', 'Redes'),
  ('BDD', 'Base de Datos'),
  ('GABD','Gestión y Administración de Base de Datos'),
  ('FIS', 'Física'),
  ('QUI', 'Química'),
  ('GPP', 'Gestión de los Procesos Productivos'),
  ('CYT', 'Ciencia y Tecnología'),
  ('CITT', 'Ciudadanía y Trabajo'),
  ('ECI', 'Educación Ciudadana'),
  ('DTEC', 'Dibujo Técnico')
ON CONFLICT (codigo) DO UPDATE
SET
  nombre = EXCLUDED.nombre;

DROP TABLE IF EXISTS ciclo_materia;

INSERT INTO
  curso (anio, division, id_ciclo_lectivo, id_especialidad)
SELECT
  years.anio,
  '1',
  cl.id_ciclo_lectivo,
  e.id_especialidad
FROM
  generate_series(1, 6) AS years (anio)
  CROSS JOIN ciclo_lectivo cl
  LEFT JOIN especialidad e
    ON years.anio >= 3
    AND e.nombre IN ('Automotores', 'Computación')
WHERE
  cl.anio = 2026
ON CONFLICT DO NOTHING;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO
  administrador (dni, nombre, apellido, email, cargo)
VALUES
  (
    '1',
    'Admin',
    'Sistema',
    'admin@gestionnotas.test',
    'Regente'
  )
ON CONFLICT (dni) DO NOTHING;

INSERT INTO
  preceptor (dni, nombre, apellido, email)
VALUES
  (
    '2',
    'Preceptor',
    'Demo',
    'preceptor@gestionnotas.test'
  )
ON CONFLICT (dni) DO NOTHING;

INSERT INTO
  profesor (dni, nombre, apellido, email, estado)
VALUES
  (
    '3',
    'Profesor',
    'Demo',
    'profesor@gestionnotas.test',
    'Activo'
  )
ON CONFLICT (dni) DO NOTHING;

INSERT INTO
  alumno (dni, nombre, apellido, email, estado)
VALUES
  (
    '4',
    'Alumno',
    'Demo',
    'alumno@gestionnotas.test',
    'Activo'
  )
ON CONFLICT (dni) DO NOTHING;

INSERT INTO
  rol (nombre, descripcion)
VALUES
  ('admin', 'Acceso administrativo'),
  ('preceptor', 'Acceso de preceptoría'),
  ('profesor', 'Acceso docente'),
  ('alumno', 'Acceso de alumno')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO
  usuario (
    nombre_usuario,
    contrasenia,
    estado,
    dni_administrador,
    id_rol
  )
SELECT
  '1',
  crypt ('1', gen_salt ('bf', 10)),
  'Activo',
  '1',
  id_rol
FROM
  rol
WHERE
  nombre = 'admin'
ON CONFLICT (nombre_usuario) DO NOTHING;

INSERT INTO
  usuario (
    nombre_usuario,
    contrasenia,
    estado,
    dni_preceptor,
    id_rol
  )
SELECT
  '2',
  crypt ('2', gen_salt ('bf', 10)),
  'Activo',
  '2',
  id_rol
FROM
  rol
WHERE
  nombre = 'preceptor'
ON CONFLICT (nombre_usuario) DO NOTHING;

INSERT INTO
  usuario (
    nombre_usuario,
    contrasenia,
    estado,
    dni_profesor,
    id_rol
  )
SELECT
  '3',
  crypt ('3', gen_salt ('bf', 10)),
  'Activo',
  '3',
  id_rol
FROM
  rol
WHERE
  nombre = 'profesor'
ON CONFLICT (nombre_usuario) DO NOTHING;

INSERT INTO
  usuario (
    nombre_usuario,
    contrasenia,
    estado,
    dni_alumno,
    id_rol
  )
SELECT
  '4',
  crypt ('4', gen_salt ('bf', 10)),
  'Activo',
  '4',
  id_rol
FROM
  rol
WHERE
  nombre = 'alumno'
ON CONFLICT (nombre_usuario) DO NOTHING;

INSERT INTO
  app_schema_migration (nombre)
VALUES
  ('especialidades_normalizadas_v1')
ON CONFLICT (nombre) DO NOTHING;
