import { createClient } from '@supabase/supabase-js';

class Database {
  constructor() {
    this.supabaseUrl = localStorage.getItem('JARAPO_SUPA_URL') || '';
    this.supabaseKey = localStorage.getItem('JARAPO_SUPA_KEY') || '';
    this.client = null;
    
    if (this.supabaseUrl && this.supabaseKey) {
      try {
        this.client = createClient(this.supabaseUrl, this.supabaseKey);
      } catch (e) {
        console.error('Error init Supabase', e);
      }
    }
  }

  setCredentials(url, key) {
    this.supabaseUrl = url;
    this.supabaseKey = key;
    localStorage.setItem('JARAPO_SUPA_URL', url);
    localStorage.setItem('JARAPO_SUPA_KEY', key);
    
    try {
      this.client = createClient(url, key);
    } catch(e) {
      console.error(e);
    }
  }

  async fetchData(table) {
    if (!this.client) return { error: 'Conexión a Supabase no configurada. Ve a Ajustes.' };
    
    try {
      // .order('id') attempts to return stable sorts (newer ones first typically or by string if id is Date.now)
      const { data, error } = await this.client.from(table).select('*').order('id', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error(`Error fetching ${table}:`, err);
      return { error: err.message };
    }
  }

  async postData(table, dataPayload, action = 'INSERT') {
    if (!this.client) throw new Error('Conexión a Supabase no configurada.');

    try {
      if (action === 'INSERT') {
          const { error } = await this.client.from(table).insert([dataPayload]);
          if (error) throw error;
      } else if (action === 'UPDATE') {
          const { error } = await this.client.from(table).update(dataPayload).eq('id', dataPayload.id);
          if (error) throw error;
      } else if (action === 'DELETE') {
          const { error } = await this.client.from(table).delete().eq('id', dataPayload.id);
          if (error) throw error;
      }
      return { success: true };
    } catch (err) {
      console.error(`Error en ${action} para ${table}:`, err);
      // 🔥 Lanzar el error para que las ventanas modales (UI) lo atrapen y no se cierren asumiendo éxito.
      throw new Error(err.message);
    }
  }

  // Ayudante para KPIs del Dashboard
  async getDashboardStats() {
    if (!this.client) return { error: 'Sin conexión a Supabase' };
    
    try {
      const ventas = await this.fetchData('Ventas') || [];
      const productos = await this.fetchData('Productos') || [];
      const clientes = await this.fetchData('Clientes') || [];
      const logistica = await this.fetchData('Logistica') || [];

      if (ventas.error) throw new Error(ventas.error);
      if (productos.error) throw new Error(productos.error);

      return {
        totalSales: ventas.reduce((sum, v) => sum + (parseFloat(v.valor_total_cop) || 0), 0),
        pendingShipments: ventas.filter(v => v.estado_orden !== 'Entregado').length,
        activeProducts: productos.length,
        totalClients: clientes.length,
        ventasRaw: ventas,
        productosRaw: productos,
        clientesRaw: clientes,
        logisticaRaw: logistica,
        ventasPendientesSaldo: ventas.filter(v => v.estado_orden === 'Recibido bodega Medellín' && parseInt(v.saldo_pendiente || "0") > 0)
      };
    } catch (err) {
      return { error: err.message };
    }
  }
    // Dashboard Analytics Pro — carga completa de todos los módulos en paralelo
    async getDashboardStatsFull() {
        if (!this.client) return { error: 'Sin conexión a Supabase' };
        try {
            const [ventas, clientes, productos, logistica, gastos, compras, abonos] = await Promise.all([
                this.fetchData('Ventas'),
                this.fetchData('Clientes'),
                this.fetchData('Productos'),
                this.fetchData('Logistica'),
                this.fetchData('Gastos'),
                this.fetchData('Compras'),
                this.fetchData('Abonos'),
            ]);
            if (ventas.error) throw new Error(ventas.error);
            return {
                ventas:    Array.isArray(ventas)    ? ventas    : [],
                clientes:  Array.isArray(clientes)  ? clientes  : [],
                productos: Array.isArray(productos)  ? productos : [],
                logistica: Array.isArray(logistica)  ? logistica : [],
                gastos:    Array.isArray(gastos)     ? gastos    : [],
                compras:   Array.isArray(compras)    ? compras   : [],
                abonos:    Array.isArray(abonos)     ? abonos    : [],
            };
        } catch (err) {
            return { error: err.message };
        }
    }

    async fetchWhere(table, column, value) {
        if (!this.client) return { error: 'Conexión a Supabase no configurada.' };
        try {
            const { data, error } = await this.client
                .from(table)
                .select('*')
                .eq(column, value)
                .order('created_at', { ascending: true });
            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error(`Error fetching ${table} where ${column}=${value}:`, err);
            return { error: err.message };
        }
    }
}

export const db = new Database();
export default db;
