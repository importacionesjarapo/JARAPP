/**
 * TablaPro — Componente de tabla avanzada para JARAPP
 * Características:
 * - Búsqueda global en Supabase (no solo página actual)
 * - Paginación sticky siempre visible
 * - Scroll horizontal interno (no afecta la página)
 * - Ordenamiento por columna (ASC/DESC) con clic en header
 * - Selector de registros por página (10, 25, 50, 100)
 * - Debounce en búsqueda (300ms)
 */

export class TablaPro {
  constructor({
    containerId,      // ID del div donde se renderiza
    tabla,            // nombre de la tabla Supabase ej: 'Ventas'
    columnas,         // array de {key, label, render?, sortable?, width?}
    filtrosExtra,     // objeto con filtros fijos ej: {estado: 'activo'}
    searchColumns,    // columnas donde buscar ej: ['nombre', 'telefono']
    acciones,         // función(row) → HTML string de botones de acción
    onRowClick,       // función(row) → callback al hacer clic en fila
    altura,           // altura máxima de la tabla ej: '500px'
    supabase,         // cliente supabase
  }) {
    this.containerId = containerId
    this.tabla = tabla
    this.columnas = columnas
    this.filtrosExtra = filtrosExtra || {}
    this.searchColumns = searchColumns || []
    this.acciones = acciones || null
    this.onRowClick = onRowClick || null
    this.altura = altura || '60vh'
    this.supabase = supabase

    // Estado
    this.pagina = 1
    this.porPagina = 25
    this.total = 0
    this.busqueda = ''
    this.ordenCol = null
    this.ordenDir = 'desc'
    this.datos = []
    this.cargando = false
    this._debounceTimer = null
  }

  // ── Render inicial ──────────────────────────────────────────────────
  async mount() {
    const container = document.getElementById(this.containerId)
    if (!container) return

    container.innerHTML = `
      <div class="tp-wrapper">

        <!-- Barra superior: búsqueda + selector por página -->
        <div class="tp-toolbar">
          <div class="tp-search-wrap">
            <i class="tp-search-icon">🔍</i>
            <input
              type="text"
              class="tp-search"
              id="tp-search-${this.containerId}"
              placeholder="Buscar en todos los registros..."
              autocomplete="off"
            >
            <button class="tp-clear-btn" id="tp-clear-${this.containerId}" style="display:none;">✕</button>
          </div>
          <div class="tp-per-page-wrap">
            <span class="tp-per-page-label">Mostrar</span>
            <select class="tp-per-page" id="tp-perpage-${this.containerId}">
              <option value="10">10</option>
              <option value="25" selected>25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
            <span class="tp-per-page-label">por página</span>
          </div>
        </div>

        <!-- Tabla con scroll interno -->
        <div class="tp-table-container" style="max-height:${this.altura};overflow-y:auto;overflow-x:auto;">
          <table class="tp-table" id="tp-table-${this.containerId}">
            <thead class="tp-thead">
              <tr>
                ${this.columnas.map(col => `
                  <th class="tp-th ${col.sortable !== false ? 'tp-sortable' : ''}"
                      data-col="${col.key}"
                      style="${col.width ? `width:${col.width}` : ''}">
                    <div class="tp-th-inner">
                      <span>${col.label}</span>
                      ${col.sortable !== false ? `
                        <span class="tp-sort-icon" data-col="${col.key}">
                          <span class="tp-sort-asc">↑</span>
                          <span class="tp-sort-desc">↓</span>
                        </span>
                      ` : ''}
                    </div>
                  </th>
                `).join('')}
                ${this.acciones ? '<th class="tp-th tp-th-acciones">Acciones</th>' : ''}
              </tr>
            </thead>
            <tbody class="tp-tbody" id="tp-tbody-${this.containerId}">
              <tr><td colspan="${this.columnas.length + (this.acciones ? 1 : 0)}" class="tp-loading">Cargando...</td></tr>
            </tbody>
          </table>
        </div>

        <!-- Paginación sticky -->
        <div class="tp-pagination" id="tp-pagination-${this.containerId}">
          <span class="tp-info" id="tp-info-${this.containerId}">—</span>
          <div class="tp-pages" id="tp-pages-${this.containerId}"></div>
        </div>

      </div>
    `

    this._bindEvents()
    await this.cargar()
  }

  // ── Eventos ─────────────────────────────────────────────────────────
  _bindEvents() {
    // Búsqueda con debounce
    const searchEl = document.getElementById(`tp-search-${this.containerId}`)
    const clearEl = document.getElementById(`tp-clear-${this.containerId}`)

    searchEl?.addEventListener('input', (e) => {
      clearTimeout(this._debounceTimer)
      this.busqueda = e.target.value.trim()
      clearEl.style.display = this.busqueda ? 'flex' : 'none'
      this._debounceTimer = setTimeout(() => {
        this.pagina = 1
        this.cargar()
      }, 300)
    })

    clearEl?.addEventListener('click', () => {
      clearTimeout(this._debounceTimer)
      searchEl.value = ''
      this.busqueda = ''
      clearEl.style.display = 'none'
      this.pagina = 1
      this.cargar()
    })

    // Selector de registros por página
    document.getElementById(`tp-perpage-${this.containerId}`)
      ?.addEventListener('change', (e) => {
        this.porPagina = parseInt(e.target.value)
        this.pagina = 1
        this.cargar()
      })

    // Ordenamiento por columna (delegación de eventos)
    document.getElementById(`tp-table-${this.containerId}`)
      ?.addEventListener('click', (e) => {
        const th = e.target.closest('.tp-sortable')
        if (!th) return
        const col = th.dataset.col
        if (this.ordenCol === col) {
          this.ordenDir = this.ordenDir === 'asc' ? 'desc' : 'asc'
        } else {
          this.ordenCol = col
          this.ordenDir = 'desc'
        }
        this.pagina = 1
        this.cargar()
      })

    // Clic en fila
    if (this.onRowClick) {
      document.getElementById(`tp-tbody-${this.containerId}`)
        ?.addEventListener('click', (e) => {
          const tr = e.target.closest('tr[data-id]')
          if (!tr) return
          const id = tr.dataset.id
          const row = this.datos.find(d => String(d.id) === String(id))
          if (row) this.onRowClick(row)
        })
    }
  }

  // ── Cargar datos desde Supabase ─────────────────────────────────────
  async cargar() {
    this.cargando = true
    this._renderLoading()

    try {
      const from = (this.pagina - 1) * this.porPagina
      const to = from + this.porPagina - 1

      let query = this.supabase
        .from(this.tabla)
        .select('*', { count: 'exact' })

      // Filtros extra fijos
      Object.entries(this.filtrosExtra).forEach(([k, v]) => {
        query = query.eq(k, v)
      })

      // Búsqueda global — busca en todas las columnas searchColumns
      if (this.busqueda && this.searchColumns.length > 0) {
        const termino = this.busqueda.toLowerCase()
        // Supabase OR con ilike en múltiples columnas
        const orConditions = this.searchColumns
          .map(col => `${col}.ilike.%${termino}%`)
          .join(',')
        query = query.or(orConditions)
      }

      // Ordenamiento
      const colOrden = this.ordenCol || 'id'
      query = query.order(colOrden, { ascending: this.ordenDir === 'asc' })

      // Paginación
      query = query.range(from, to)

      const { data, count, error } = await query
      if (error) throw error

      this.datos = data || []
      this.total = count || 0
      this._renderTabla()
      this._renderPaginacion()

    } catch (err) {
      console.error('[TablaPro] Error cargando datos:', err)
      this._renderError(err.message)
    } finally {
      this.cargando = false
    }
  }

  // ── Render tabla ────────────────────────────────────────────────────
  _renderTabla() {
    const tbody = document.getElementById(`tp-tbody-${this.containerId}`)
    if (!tbody) return

    // Actualizar íconos de ordenamiento en headers
    document.querySelectorAll(`#tp-table-${this.containerId} .tp-sort-icon`).forEach(el => {
      const col = el.dataset.col
      el.querySelector('.tp-sort-asc').style.opacity = (this.ordenCol === col && this.ordenDir === 'asc') ? '1' : '0.2'
      el.querySelector('.tp-sort-desc').style.opacity = (this.ordenCol === col && this.ordenDir === 'desc') ? '1' : '0.2'
    })

    if (this.datos.length === 0) {
      const cols = this.columnas.length + (this.acciones ? 1 : 0)
      tbody.innerHTML = `
        <tr>
          <td colspan="${cols}" class="tp-empty">
            ${this.busqueda ? `No se encontraron resultados para "<b>${this.busqueda}</b>"` : 'Sin registros'}
          </td>
        </tr>
      `
      return
    }

    tbody.innerHTML = this.datos.map(row => `
      <tr class="tp-tr ${this.onRowClick ? 'tp-tr-clickable' : ''}" data-id="${row.id}">
        ${this.columnas.map(col => `
          <td class="tp-td">
            ${col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
          </td>
        `).join('')}
        ${this.acciones ? `<td class="tp-td tp-td-acciones">${this.acciones(row)}</td>` : ''}
      </tr>
    `).join('')
  }

  // ── Render paginación ───────────────────────────────────────────────
  _renderPaginacion() {
    const totalPaginas = Math.ceil(this.total / this.porPagina)
    const desde = ((this.pagina - 1) * this.porPagina) + 1
    const hasta = Math.min(this.pagina * this.porPagina, this.total)

    // Info
    const infoEl = document.getElementById(`tp-info-${this.containerId}`)
    if (infoEl) {
      infoEl.textContent = this.total > 0
        ? `${desde}–${hasta} de ${this.total} registros${this.busqueda ? ` · Filtrado por "${this.busqueda}"` : ''}`
        : 'Sin resultados'
    }

    // Páginas
    const pagesEl = document.getElementById(`tp-pages-${this.containerId}`)
    if (!pagesEl) return

    if (totalPaginas <= 1) { pagesEl.innerHTML = ''; return }

    // Generar números de página inteligentes
    const paginas = []
    paginas.push(1)
    if (this.pagina > 3) paginas.push('...')
    for (let i = Math.max(2, this.pagina - 1); i <= Math.min(totalPaginas - 1, this.pagina + 1); i++) {
      paginas.push(i)
    }
    if (this.pagina < totalPaginas - 2) paginas.push('...')
    if (totalPaginas > 1) paginas.push(totalPaginas)

    pagesEl.innerHTML = `
      <button class="tp-page-btn" ${this.pagina === 1 ? 'disabled' : ''} data-page="${this.pagina - 1}">←</button>
      ${paginas.map(p => p === '...'
        ? `<span class="tp-page-dots">···</span>`
        : `<button class="tp-page-btn ${p === this.pagina ? 'tp-page-active' : ''}" data-page="${p}">${p}</button>`
      ).join('')}
      <button class="tp-page-btn" ${this.pagina === totalPaginas ? 'disabled' : ''} data-page="${this.pagina + 1}">→</button>
    `

    // Event listeners de páginas
    pagesEl.querySelectorAll('.tp-page-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        this.pagina = parseInt(btn.dataset.page)
        this.cargar()
        // Scroll al inicio de la tabla
        document.getElementById(this.containerId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  _renderLoading() {
    const tbody = document.getElementById(`tp-tbody-${this.containerId}`)
    if (tbody) {
      const cols = this.columnas.length + (this.acciones ? 1 : 0)
      tbody.innerHTML = `
        <tr><td colspan="${cols}" class="tp-loading">
          <div class="tp-spinner"></div> Cargando...
        </td></tr>
      `
    }
  }

  _renderError(msg) {
    const tbody = document.getElementById(`tp-tbody-${this.containerId}`)
    if (tbody) {
      const cols = this.columnas.length + (this.acciones ? 1 : 0)
      tbody.innerHTML = `<tr><td colspan="${cols}" class="tp-error">Error: ${msg}</td></tr>`
    }
  }

  // ── API pública ─────────────────────────────────────────────────────
  refresh() { this.cargar() }

  setFiltro(key, value) {
    this.filtrosExtra[key] = value
    this.pagina = 1
    this.cargar()
  }

  removeFiltro(key) {
    delete this.filtrosExtra[key]
    this.pagina = 1
    this.cargar()
  }
}
