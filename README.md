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
4. Para usar la demo completamente local, configurar `VITE_DEMO_MODE=true`; por defecto la interfaz se conecta al backend y a PostgreSQL. Los horarios oficiales se comparten entre la demo local y la base de datos.
5. Instalar las dependencias:

```bash
npm install
```

6. Aplicar la migración y el esquema:

```bash
node scripts/init-db.cjs
```

## Despliegue Cloudflare + Render

- En Render, crea un servicio web con `npm install && npm run build` como comando de compilación y `npm run server` como comando de inicio. Configura `DATABASE_URL`, `DATABASE_SSL=true` si PostgreSQL requiere SSL, y `CORS_ORIGIN` con el dominio de Cloudflare Pages y cualquier dominio personalizado.
- En Cloudflare Pages, usa `npm run build` como comando de compilación y `dist` como directorio de salida. Define `VITE_API_URL` como la URL pública de la API de Render terminada en `/api` y `VITE_DEMO_MODE=false`.
- Los turnos son datos oficiales: el backend los sirve desde `/api/turnos` y los inicializa en la base de datos; el modo demo usa una copia local de esos mismos horarios y no realiza llamadas al servidor.

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

Todos usan contraseña `1234`:

| Usuario | Rol |
|---|---|
| `admin` | Administrador |
| `31928371` | Profesor |
| `96103383` | Alumno |
| `preceptor` | Preceptor |

El backend crea esos usuarios automáticamente si las tablas correspondientes ya existen.

## Qué quedó conectado

- Login real contra PostgreSQL.
- Sesión persistida en `localStorage` mediante token de memoria del backend.
- Dashboard con datos reales.
- Listado y filtros de alumnos.
- Alta y modificación de alumnos según rol.
- Listado de docentes.
- Listado de cursos.
- Listado de materias.
- Carga y edición de calificaciones.
- Promedio sugerido para bimestre 1 + bimestre 2.
- Consulta de calificaciones del alumno.
- Notificaciones y alertas a partir de las notas.

## Base de datos

`scripts/init-db.cjs` aplica la migración del modelo anterior y luego el esquema actual. Ejecutalo una vez con PostgreSQL accesible y `DATABASE_URL` configurado.
El esquema crea 12 cursos para el ciclo actual: seis años y dos especialidades, Automotores y Computación, ambas en división 1. Los turnos se relacionan con el curso sin generar tarjetas duplicadas.
