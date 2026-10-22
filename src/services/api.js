const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')

let token = localStorage.getItem('gestion_notas_token') || ''
let activeCycleYear = Number(localStorage.getItem('gestion_notas_ciclo_lectivo')) || null

export function getActiveCycleYear() {
  return activeCycleYear
}

export function setActiveCycleYear(year) {
  activeCycleYear = Number(year) || null
  if (activeCycleYear) localStorage.setItem('gestion_notas_ciclo_lectivo', String(activeCycleYear))
  else localStorage.removeItem('gestion_notas_ciclo_lectivo')
}

export function setToken(nextToken) {
  token = nextToken || ''
  if (token) localStorage.setItem('gestion_notas_token', token)
  else localStorage.removeItem('gestion_notas_token')
}

export function getToken() {
  return token
}

export function clearSession() {
  setToken('')
  localStorage.removeItem('gestion_notas_user')
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('gestion_notas_user') || 'null')
  } catch {
    return null
  }
}

export function setStoredUser(user) {
  localStorage.setItem('gestion_notas_user', JSON.stringify(user))
}

export async function apiFetch(path, options = {}) {
  const [requestPath, queryString = ''] = path.split('?')
  const params = new URLSearchParams(queryString)

  if (activeCycleYear && !requestPath.startsWith('/ciclos-lectivos')) {
    params.set('ciclo_lectivo', String(activeCycleYear))
  }

  const headers = new Headers(options.headers || {})
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  if (options.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const query = params.toString()
  const endpoint = `${API_BASE}/${requestPath.replace(/^\/+/, '')}${query ? `?${query}` : ''}`
  const response = await fetch(endpoint, { ...options, headers })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    if (response.status === 401) clearSession()
    throw new Error(data.error || `HTTP ${response.status}`)
  }

  return data
}

export async function login(usuario, contrasenia) {
  const result = await apiFetch('/login', {
    method: 'POST',
    body: JSON.stringify({ usuario, contrasenia }),
  })

  setToken(result.token)
  setStoredUser(result.usuario)
  return result.usuario
}

export async function logout() {
  try {
    if (token) await apiFetch('/logout', { method: 'POST' })
  } finally {
    clearSession()
  }
}
