import { TURNOS_OFICIALES } from '../data/turnos'

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

let token = localStorage.getItem('gestion_notas_token') || ''

// =====================================================
// DATOS DEMO
// =====================================================

const DEMO_USER = {
  id_usuario: 1,
  rol: 'admin',
  nombre: 'Administrador',
  dni_alumno: null,
  dni_profesor: null,
}

const DEMO_ACCOUNTS = {
  admin: DEMO_USER,
  '31928371': {
    id_usuario: 2,
    rol: 'profesor',
    nombre: 'Moya, Juan',
    dni_alumno: null,
    dni_profesor: '31928371',
  },
  '96103383': {
    id_usuario: 3,
    rol: 'alumno',
    nombre: 'Rodriguez, Luis',
    dni_alumno: '96103383',
    dni_profesor: null,
  },
  preceptor: {
    id_usuario: 4,
    rol: 'preceptor',
    nombre: 'Preceptor',
    dni_alumno: null,
    dni_profesor: null,
  },
}

const DEMO_ALUMNOS = [
  {
    dni: '45123456',
    nombre: 'Juan',
    apellido: 'Pérez',
    email: 'juan@mail.com',
    estado: 'Activo',
    id_curso: 11,
    anio: 6,
    division: '1',
    ciclo_lectivo: 2026,
    promedio: 8.5,
  },
  {
    dni: '45987654',
    nombre: 'Martina',
    apellido: 'Gómez',
    email: 'martina@mail.com',
    estado: 'Activo',
    id_curso: 11,
    anio: 6,
    division: '1',
    ciclo_lectivo: 2026,
    promedio: 9.2,
  },
  {
    dni: '46321478',
    nombre: 'Lucas',
    apellido: 'Rodríguez',
    email: 'lucas@mail.com',
    estado: 'Activo',
    id_curso: 12,
    anio: 6,
    division: '1',
    ciclo_lectivo: 2026,
    promedio: 7.4,
  },
  {
    dni: '45876543',
    nombre: 'Sofía',
    apellido: 'Fernández',
    email: 'sofia@mail.com',
    estado: 'Activo',
    id_curso: 12,
    anio: 6,
    division: '1',
    ciclo_lectivo: 2026,
    promedio: 6.8,
  },
]

const DEMO_DOCENTES = [
  {
    dni: '30123456',
    nombre: 'Carlos',
    apellido: 'García',
    email: 'carlos@mail.com',
  },
  {
    dni: '28987654',
    nombre: 'María',
    apellido: 'López',
    email: 'maria@mail.com',
  },
]

let DEMO_CURSOS = Array.from({ length: 6 }, (_, index) => {
  const anio = index + 1
  const idCursoAutomotores = index * 2 + 1
  const idCursoComputacion = idCursoAutomotores + 1
  const cantidadAlumnos = anio === 6 ? 2 : 0
  const turnoAutomotores = TURNOS_OFICIALES[Math.floor(Math.random() * TURNOS_OFICIALES.length)]
  const turnoComputacion = anio === 6
    ? TURNOS_OFICIALES.find((turno) => turno.jornada === 'Mañana')
    : TURNOS_OFICIALES[Math.floor(Math.random() * TURNOS_OFICIALES.length)]

  return [
    {
      id_curso: idCursoAutomotores,
      anio,
      division: '1',
      especialidad: 'Automotores',
      turno: turnoAutomotores.jornada,
      turno_id: turnoAutomotores.id_turno,
      ciclo_lectivo: 2026,
      cantidad_alumnos: cantidadAlumnos,
    },
    {
      id_curso: idCursoComputacion,
      anio,
      division: '1',
      especialidad: 'Computación',
      turno: turnoComputacion.jornada,
      turno_id: turnoComputacion.id_turno,
      ciclo_lectivo: 2026,
      cantidad_alumnos: cantidadAlumnos,
    },
  ]
}).flat()

const DEMO_MATERIAS = [
  {
    codigo_materia: 'PROG',
    nombre: 'Programación',
  },
  {
    codigo_materia: 'MAT',
    nombre: 'Matemática',
  },
  {
    codigo_materia: 'RED',
    nombre: 'Redes',
  },
]

const DEMO_NOTAS = [
  {
    dni_alumno: '45123456',
    alumno: 'Pérez Juan',
    materia: 'Programación',
    tipo_evaluacion: '1er Bimestre',
    calificacion: 9,
  },
  {
    dni_alumno: '45987654',
    alumno: 'Gómez Martina',
    materia: 'Matemática',
    tipo_evaluacion: '1er Bimestre',
    calificacion: 8,
  },
]

const DEMO_MIS_NOTAS = [
  {
    materia: 'Programación',
    prof: 'Carlos García',
    bim1: 9,
    bim2: 9,
    cuat1: 9,
    bim3: 8,
    bim4: 7,
    cuat2: 8,
    final: 9,
  },
  {
    materia: 'Matemática',
    prof: 'María López',
    bim1: 8,
    bim2: 7,
    cuat1: 8,
    bim3: 6,
    bim4: 8,
    cuat2: 7,
    final: 8,
  },
]

const DEMO_NOTIFICACIONES = [
  {
    id_nota: 1,
    nombre: 'Juan',
    apellido: 'Pérez',
    materia: 'Programación',
    tipo_evaluacion: '1er Bimestre',
    calificacion: 9,
    fecha: '2026-03-10',
    tipo: 'Informe',
  },
  {
    id_nota: 2,
    nombre: 'Lucas',
    apellido: 'Rodríguez',
    materia: 'Matemática',
    tipo_evaluacion: '1er Bimestre',
    calificacion: 5,
    fecha: '2026-03-08',
    tipo: 'Crítica',
  },
]

// =====================================================
// TOKEN / SESIÓN
// =====================================================

export function setToken(nextToken) {
  token = nextToken || ''

  if (token) {
    localStorage.setItem('gestion_notas_token', token)
  } else {
    localStorage.removeItem('gestion_notas_token')
  }
}

export function getToken() {
  return token
}

export function clearSession() {
  token = ''
  localStorage.removeItem('gestion_notas_token')
  localStorage.removeItem('gestion_notas_user')
}

export function getStoredUser() {
  try {
    return JSON.parse(
      localStorage.getItem('gestion_notas_user') || 'null'
    )
  } catch {
    return null
  }
}

export function setStoredUser(user) {
  localStorage.setItem(
    'gestion_notas_user',
    JSON.stringify(user)
  )
}

// =====================================================
// API PRINCIPAL
// =====================================================

export async function apiFetch(path, options = {}) {
  // ===============================================
  // MODO DEMO
  // No hace ninguna petición HTTP.
  // ===============================================

  if (DEMO_MODE) {
    return demoApiFetch(path, options)
  }

  // ===============================================
  // MODO REAL
  // Usa el backend /api
  // ===============================================

  const headers = {
    ...(options.body instanceof FormData
      ? {}
      : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    if (response.status === 401) {
      clearSession()
    }

    throw new Error(
      data.error || `HTTP ${response.status}`
    )
  }

  return data
}

// =====================================================
// LOGIN
// =====================================================

export async function login(usuario, contrasenia) {
  // ===============================================
  // LOGIN DEMO
  // ===============================================

  if (DEMO_MODE) {
    const demoUser = DEMO_ACCOUNTS[usuario]
    if (!demoUser || contrasenia !== '1234') {
      throw new Error('Usuario o contraseña incorrectos. En demo, la contraseña es 1234.')
    }

    setToken('demo-token')
    setStoredUser(demoUser)

    console.log('[DEMO] Login realizado')

    return demoUser
  }

  // ===============================================
  // LOGIN REAL
  // ===============================================

  const result = await apiFetch('/login', {
    method: 'POST',
    body: JSON.stringify({
      usuario,
      contrasenia,
    }),
  })

  setToken(result.token)
  setStoredUser(result.usuario)

  return result.usuario
}

// =====================================================
// LOGOUT
// =====================================================

export async function logout() {
  try {
    if (!DEMO_MODE && token) {
      await apiFetch('/logout', {
        method: 'POST',
      })
    }
  } finally {
    clearSession()
  }
}

// =====================================================
// API DEMO
// =====================================================

async function demoApiFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()

  console.log(`[DEMO API] ${method} ${path}`)

  // ===============================================
  // SESIÓN
  // ===============================================

  if (path === '/me') {
    return getStoredUser() || DEMO_USER
  }

  // ===============================================
  // DASHBOARD
  // ===============================================

  if (path === '/dashboard') {
    const alumnosActivos = DEMO_ALUMNOS.filter(
      (alumno) => alumno.estado === 'Activo'
    ).length

    const aprobados = DEMO_ALUMNOS.filter(
      (alumno) => Number(alumno.promedio) >= 6
    ).length

    return {
      alumnos_activos: alumnosActivos,
      aprobados,
    }
  }

  // ===============================================
  // ALUMNOS
  // ===============================================

  if (path === '/alumnos' && method === 'GET') {
    return [...DEMO_ALUMNOS]
  }

  if (path.startsWith('/alumnos/') && method === 'GET') {
    return (
      DEMO_ALUMNOS.find(
        (alumno) => path === `/alumnos/${alumno.dni}`
      ) || null
    )
  }

  // ===============================================
  // DOCENTES
  // ===============================================

  if (path === '/docentes' && method === 'GET') {
    return [...DEMO_DOCENTES]
  }

  // ===============================================
  // CURSOS
  // ===============================================

  if (path === '/cursos' && method === 'GET') {
    return [...DEMO_CURSOS]
  }

  if (path === '/cursos' && method === 'POST') {
    const body = JSON.parse(options.body || '{}')
    const anio = Number(body.anio)
    if (DEMO_CURSOS.some((curso) => curso.anio === anio && curso.especialidad === body.especialidad && curso.ciclo_lectivo === 2026)) {
      throw new Error('Ya existe ese curso en el ciclo lectivo actual')
    }
    const turno = TURNOS_OFICIALES.find((item) => item.id_turno === Number(body.turno_id)) || null
    const curso = {
      id_curso: Math.max(0, ...DEMO_CURSOS.map((item) => item.id_curso)) + 1,
      anio,
      division: '1',
      especialidad: body.especialidad,
      ciclo_lectivo: 2026,
      cantidad_alumnos: 0,
      turno: turno?.jornada || null,
      turno_id: turno?.id_turno || null,
    }
    DEMO_CURSOS.push(curso)
    return { ...curso }
  }

  const courseMatch = path.match(/^\/cursos\/(\d+)$/)
  if (courseMatch && method === 'PUT') {
    const idCurso = Number(courseMatch[1])
    const curso = DEMO_CURSOS.find((item) => item.id_curso === idCurso)
    if (!curso) throw new Error('Curso no encontrado')
    const body = JSON.parse(options.body || '{}')
    const anio = Number(body.anio)
    if (DEMO_CURSOS.some((item) => item.id_curso !== idCurso && item.anio === anio && item.especialidad === body.especialidad && item.ciclo_lectivo === 2026)) {
      throw new Error('Ya existe ese curso en el ciclo lectivo actual')
    }
    const turno = TURNOS_OFICIALES.find((item) => item.id_turno === Number(body.turno_id)) || null
    Object.assign(curso, {
      anio,
      division: '1',
      especialidad: body.especialidad,
      turno: turno?.jornada || null,
      turno_id: turno?.id_turno || null,
    })
    return { ...curso }
  }

  if (courseMatch && method === 'DELETE') {
    const idCurso = Number(courseMatch[1])
    if (DEMO_ALUMNOS.some((alumno) => alumno.id_curso === idCurso)) {
      throw new Error('No se puede eliminar un curso con alumnos o notas asociadas')
    }
    DEMO_CURSOS = DEMO_CURSOS.filter((curso) => curso.id_curso !== idCurso)
    return { ok: true }
  }

  if (path === '/turnos' && method === 'GET') {
    return TURNOS_OFICIALES.map((turno) => ({ ...turno }))
  }

  // ===============================================
  // MATERIAS
  // ===============================================

  if (path === '/materias' && method === 'GET') {
    return [...DEMO_MATERIAS]
  }

  // ===============================================
  // NOTAS
  // ===============================================

  if (path.startsWith('/notas') && method === 'GET') {
    return [...DEMO_NOTAS]
  }

  // ===============================================
  // MIS NOTAS
  // ===============================================

  if (path === '/mis-notas' && method === 'GET') {
    return [...DEMO_MIS_NOTAS]
  }

  // ===============================================
  // NOTIFICACIONES
  // ===============================================

  if (path === '/notificaciones' && method === 'GET') {
    return [...DEMO_NOTIFICACIONES]
  }

  // ===============================================
  // OPERACIONES POST / PUT / PATCH
  // Simulación de respuesta exitosa
  // ===============================================

  if (
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH'
  ) {
    return {
      ok: true,
      mensaje: 'Operación realizada correctamente',
    }
  }

  // ===============================================
  // DELETE
  // ===============================================

  if (method === 'DELETE') {
    return {
      ok: true,
      mensaje: 'Operación eliminada correctamente',
    }
  }

  // ===============================================
  // Endpoint no simulado
  // ===============================================

  return []
}
