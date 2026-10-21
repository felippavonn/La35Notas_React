BEGIN;

CREATE TABLE IF NOT EXISTS especialidad (
    id_especialidad SERIAL PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL UNIQUE
);

INSERT INTO especialidad (nombre)
VALUES ('Automotores'), ('Computación')
ON CONFLICT (nombre) DO NOTHING;

DO $$
DECLARE
  had_course_turnos BOOLEAN := to_regclass('public.curso_turno') IS NOT NULL;
BEGIN
  IF to_regclass('public.curso') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO turno (jornada, hora_inicio, hora_fin, entrada_prehora, salida_poshora)
  SELECT 'Mañana', '07:40', '12:10', '07:10', '12:50'
  WHERE NOT EXISTS (SELECT 1 FROM turno WHERE jornada='Mañana');
  INSERT INTO turno (jornada, hora_inicio, hora_fin, entrada_prehora, salida_poshora)
  SELECT 'Tarde', '13:30', '18:00', '12:50', '18:40'
  WHERE NOT EXISTS (SELECT 1 FROM turno WHERE jornada='Tarde');
  INSERT INTO turno (jornada, hora_inicio, hora_fin, entrada_prehora, salida_poshora)
  SELECT 'Noche', '18:10', '22:40', '17:30', '23:20'
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