const DEMO_MODE = false

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

const DEMO_ALUMNOS = [
  {
    dni: '45123456',
    nombre: 'Juan',
    apellido: 'Pérez',
    email: 'juan@mail.com',
    estado: 'Activo',
    id_curso: 1,
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
    id_curso: 1,
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
    id_curso: 2,
    anio: 6,
    division: '2',
    ciclo_lectivo: 2026,
    promedio: 7.4,
  },
  {
    dni: '45876543',
    nombre: 'Sofía',
    apellido: 'Fernández',
    email: 'sofia@mail.com',
    estado: 'Activo',
    id_curso: 2,
    anio: 6,
    division: '2',
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

const DEMO_CURSOS = [
  {
    id_curso: 1,
    anio: 6,
    division: '1',
    ciclo_lectivo: 2026,
  },
  {
    id_curso: 2,
    anio: 6,
    division: '2',
    ciclo_lectivo: 2026,
  },
]

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
    final: 9,
  },
  {
    materia: 'Matemática',
    prof: 'María López',
    bim1: 8,
    bim2: 7,
    cuat1: 8,
    final: 8,
  },
]

const DEMO_NOTIFICACIONES = [
  {
    id_notificacion: 1,
    titulo: 'Nueva calificación',
    mensaje: 'Se registró una nueva calificación.',
    leida: false,
  },
  {
    id_notificacion: 2,
    titulo: 'Recordatorio',
    mensaje: 'Hay notas pendientes de revisar.',
    leida: false,
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
    if (!usuario || !contrasenia) {
      throw new Error('Ingresá usuario y contraseña')
    }

    const demoUser = {
      ...DEMO_USER,
      nombre: usuario,
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