# la35Notas — React + Express + PostgreSQL

Migración de la aplicación anterior a una única estructura de proyecto.

## Estructura

```text
La35Notas_React/
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── styles.css
│   └── services/api.js
├── server.js
├── index.html
├── package.json
├── vite.config.js
├── eslint.config.js
├── .env.example
└── start.bat
```

Ya no hay un segundo `package.json`, ni otro `index.html`, ni un `api.js` global para manipular el DOM. React se encarga de la interfaz y `src/services/api.js` de las llamadas HTTP.

## Requisitos

- Node.js
- PostgreSQL con una base `gestion_notas` accesible desde el backend.

## Instalación

1. Copiar `.env.example` como `.env`.
2. Configurar `DATABASE_URL` con la conexión PostgreSQL. Dejar `DATABASE_SSL=false` para una instalación local; usar `true` si el proveedor requiere SSL.
3. `CORS_ORIGIN` acepta una lista separada por comas de los orígenes permitidos. Para producción, configura el dominio de Cloudflare Pages.
4. Para usar la demo completamente local, configurar `VITE_DEMO_MODE=true`; por defecto la interfaz se conecta al backend y a PostgreSQL. Los turnos Mañana, Tarde y Noche se comparten entre la demo local y la base de datos, sin almacenar horarios.
5. Instalar las dependencias:

```bash
npm install
```

6. Aplicar el esquema inicial sobre una base PostgreSQL vacía:

```bash
node scripts/init-db.cjs
```

## Despliegue Cloudflare + Render

- En Render, crea un servicio web con `npm install --include=dev && npm run build` como comando de compilación y `npm run server` como comando de inicio. `--include=dev` instala Vite para compilar la interfaz. Configura `DATABASE_URL`, `DATABASE_SSL=true` si PostgreSQL requiere SSL, y `CORS_ORIGIN` con el dominio de Cloudflare Pages y cualquier dominio personalizado.
- En Cloudflare Pages, usa `npm run build` como comando de compilación y `dist` como directorio de salida. Define `VITE_API_URL` como la URL pública de la API de Render terminada en `/api` y `VITE_DEMO_MODE=false`.
- Mañana, Tarde y Noche forman un catálogo global de turnos, independiente del ciclo lectivo, igual que las especialidades; el backend lo sirve desde `/api/turnos` y el modo demo usa una copia local. No se guardan horas de entrada, salida, prehora ni poshora.

## Ejecutar en desarrollo

Abrí dos terminales:

```bash
npm run server
```

```bash
npm run dev
```

O usá `start.bat` para abrir ambos procesos en ventanas separadas.

La interfaz queda normalmente en `http://localhost:5173` y el backend en `http://localhost:3000`.

En desarrollo, Vite redirige `/api/*` al backend. En Cloudflare Pages, `VITE_API_URL` apunta al backend de Render.

## Ejecutar como aplicación compilada

```bash
npm run build
npm run server
```

Cuando existe `dist/`, Express la sirve desde `http://localhost:3000`.

## Usuarios de demo

La contraseña de cada cuenta es su propio DNI:

| Usuario | Rol           |
| ------- | ------------- |
| `1`     | Administrador |
| `2`     | Preceptor     |
| `3`     | Profesor      |
| `4`     | Alumno        |

La inicialización crea estas cuatro cuentas de demostración con el DNI como usuario y contraseña. Al arrancar, el backend también crea cuentas para las demás personas registradas que todavía no tengan una cuenta asociada y sincroniza las contraseñas de las cuentas vinculadas con su DNI.

## Qué quedó conectado

- Login real contra PostgreSQL.
- La sesión se conserva en `localStorage`; al volver a abrir la aplicación, continúa abierta hasta cerrar sesión.
- Dashboard con datos reales.
- Listado y filtros de alumnos.
- Alta y modificación de alumnos según rol.
- Listado de docentes.
- Administración de docentes para administradores y preceptores, con estado laboral, materias asignables sin curso y cursos por materia.
- Gestión exclusiva para administradores de preceptores y administradores, con cuentas de acceso asociadas; los administradores pueden tener cargo de Regente o Subregente.
- Listado y administración de cursos, con asignación y visualización de las materias existentes.
- Catálogo global de materias: cada materia se guarda una sola vez y se puede asignar a los ciclos que la utilizan; los cursos conservan sus asignaciones por ciclo.
- Al cambiar un alumno de curso dentro del ciclo lectivo: se borran sus notas generales e individuales si cambia de año; si cambia de especialidad se borran solo las notas de materias que no están en el nuevo curso; cambiar de división conserva todas las notas. Las notas conservadas se vinculan al curso nuevo.
- Selector de ciclo lectivo exclusivo para administradores; los demás roles siempre consultan el ciclo más reciente.
- Creación de ciclos lectivos con opción de copiar cursos, materias asignadas y asignaciones docentes de otro ciclo; el catálogo global de materias y los turnos Mañana, Tarde y Noche se reutilizan en todos los ciclos.
- Selección de turnos Mañana, Tarde y Noche al crear o editar cursos.
- Administración de ciclos lectivos para administradores, con bloqueo de eliminación si tienen datos asociados.
- Administración de materias exclusiva para administradores: el catálogo global se asigna por ciclo y no se puede quitar una materia del ciclo si tiene cursos, asignaciones docentes o calificaciones asociados.
- Carga y edición de calificaciones.
- Registro de evaluaciones individuales por tema, período, estado y nota, con seguimiento de si se adeuda el tema cuando la nota es menor que 6.
- Notificaciones persistentes al alumno al cargar calificaciones generales o individuales, con ciclo lectivo y opción de activarlas o desactivarlas (activadas por defecto); al eliminar notas se notifica siempre. Los indicadores distinguen aprobación, desaprobación con deuda y desaprobación sin deuda.
- Notificaciones del alumno agrupadas por año.
- Promedio sugerido para bimestre 1 + bimestre 2.
- Boletines con búsqueda por DNI y nombre, filtros por curso y estado, promedios anuales y generales, historial de calificaciones paginado y acceso del alumno a todos sus ciclos lectivos. Cada ciclo muestra un solo curso: el vigente o, si ya no hay una inscripción vigente, el último de ese ciclo.
- Notificaciones y alertas a partir de las notas.

## Base de datos

`scripts/init-db.cjs` ejecuta `database/schema.sql` únicamente sobre una base PostgreSQL vacía. No contiene migraciones ni actualiza instalaciones existentes. Ejecutalo una sola vez con `DATABASE_URL` configurado; no incluyas este comando en los builds recurrentes de Render, porque las tablas ya estarán creadas. Para Render, el build debe ser `npm install --include=dev && npm run build`.

En una base vacía, el esquema crea el ciclo lectivo 2026, las especialidades Automotores y Computación, y 10 cursos de división 1: uno sin especialidad para 1.º y 2.º, y uno por especialidad de 3.º a 6.º. También crea las cuentas de demostración para administrador (DNI 1), preceptor (DNI 2), profesor (DNI 3) y alumno (DNI 4), con contraseña igual al DNI.

El catálogo global inicial contiene una sola fila por materia: Matemática, Lengua y Literatura, Prácticas Profesionalizantes, Programación sobre Redes, Educación Física, Inglés, Historia, Desarrollo de Sistemas, Administración de Sistemas y Redes, Redes, Base de Datos, Gestión y Administración de base de datos, Física, Química, Gestión de los Procesos Productivos, Ciencia y Tecnología, Ciudadanía y Trabajo, Educación Ciudadana y Dibujo Técnico. Cada ciclo lectivo puede asignar las materias del catálogo que utiliza. Mañana, Tarde y Noche también forman un catálogo global y no guardan horarios.
