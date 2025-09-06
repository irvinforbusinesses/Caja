// index.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Verificar variables de entorno (no imprimir llaves en consola)
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('Error: Variables de entorno SUPABASE_URL o SUPABASE_KEY no cargadas');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

console.log('Servidor arrancando y Supabase configurado');

// --- Helpers de fecha/hora ---

// Devuelve hora actual en Nicaragua en formato HH:MM:SS (24h)
function obtenerHoraNicaragua() {
  const tz = "America/Managua";
  const now = new Date();
  const horaFinal = new Intl.DateTimeFormat("es-NI", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);
  return horaFinal; // "HH:MM:SS"
}

// Normaliza diferentes formatos de fecha de entrada a "YYYY-MM-DD" o devuelve null si no válida
function normalizarFechaAISO(fechaInput) {
  if (!fechaInput) return null;
  const s = String(fechaInput).trim();

  // 1) ISO ya: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // 2) DD/MM/YYYY o D/M/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 3) DD-MM-YYYY o D-M-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
    const [d, m, y] = s.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 4) Intentar parsear con Date (fallback). Si parsea, formatear según zona America/Managua
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const tz = "America/Managua";
    const fechaStr = new Intl.DateTimeFormat("es-NI", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(parsed); // formato "DD/MM/YYYY" en es-NI
    const [dia, mes, anio] = fechaStr.split('/');
    return `${anio}-${mes}-${dia}`;
  }

  return null;
}

// --- Rutas ---

app.get('/', (req, res) => {
  res.send('Servidor corriendo y conectado a Supabase!');
});

/**
 * POST /
 * Body esperado (ejemplos):
 * {
 *   accion: "registrar" | "cancelar",
 *   fecha: "YYYY-MM-DD" ,                        // opcional
 *   productos: [
 *     { producto_id: 1, cantidad: 2, fecha: "DD/MM/YYYY" }, // fecha por producto (opcional)
 *     { producto_id: 2, cantidad: 1 }                        // si no tiene fecha -> usa body.fecha si existe -> si no -> usa fecha actual de Nicaragua
 *   ]
 * }
 */
app.post('/', async (req, res) => {
  const { accion = "registrar", productos, fecha: fechaGlobal } = req.body;

  // Validación básica para registrar: productos obligatorios
  if (accion === "registrar") {
    if (!productos || !Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: 'La lista de productos vendidos es obligatoria' });
    }
  }

  // Normalizar fecha global (si la envía el usuario)
  const fechaGlobalISO = fechaGlobal ? normalizarFechaAISO(fechaGlobal) : null;
  if (fechaGlobal && !fechaGlobalISO) {
    return res.status(400).json({ error: 'Fecha global inválida. Use YYYY-MM-DD o DD/MM/YYYY' });
  }

  // Obtener hora actual de Nicaragua (se usa para todas las filas en esta petición)
  const horaActualNica = obtenerHoraNicaragua();

  // Obtener fecha actual de Nicaragua por defecto (si ni producto ni fecha global la especifican)
  const ahora = new Date();
  const tz = "America/Managua";
  const fechaActualNicaStr = new Intl.DateTimeFormat("es-NI", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(ahora);
  const [diaAct, mesAct, anioAct] = fechaActualNicaStr.split('/');
  const fechaActualISO = `${anioAct}-${mesAct}-${diaAct}`;

  try {
    if (accion === "registrar") {
      // Construir filas teniendo en cuenta: fecha por producto > fecha global > fecha actual de Nicaragua
      const filas = [];
      for (const item of productos) {
        if (!item.producto_id || typeof item.cantidad !== 'number') {
          return res.status(400).json({ error: 'Cada producto necesita producto_id y cantidad (número)' });
        }

        // Prioridad de fecha: item.fecha -> fechaGlobalISO -> fechaActualISO
        let fechaItemISO = null;
        if (item.fecha) {
          fechaItemISO = normalizarFechaAISO(item.fecha);
          if (!fechaItemISO) {
            return res.status(400).json({
              error: `Fecha inválida en producto ${item.producto_id}. Use YYYY-MM-DD o DD/MM/YYYY`
            });
          }
        } else if (fechaGlobalISO) {
          fechaItemISO = fechaGlobalISO;
        } else {
          fechaItemISO = fechaActualISO;
        }

        filas.push({
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          fecha: fechaItemISO,
          hora: horaActualNica
        });
      }

      const { data, error } = await supabase
        .from('ventas')
        .insert(filas);

      if (error) {
        console.error('Error insertando ventas:', error);
        throw error;
      }

      return res.status(200).json({ mensaje: 'Venta registrada correctamente', data });
    } else if (accion === "cancelar") {
      // Nota importante de seguridad: solo interpretamos "borrar todo el día" si
      // el cliente NO envió el campo productos (productos === undefined || productos === null).
      // Si vino un array vacío [], lo tratamos como intención de cancelar por producto, y
      // requerimos que contenga items para poder proceder.
      const productosPresentes = Array.isArray(productos) ? productos.length > 0 : false;

      // Si NO vienen productos (campo ausente/null/undefined) y SÍ viene fecha -> borrar todo lo de esa fecha
      if ((productos === undefined || productos === null) && fechaGlobalISO) {
        const { data: deletedRows, error: errDel } = await supabase
          .from('ventas')
          .delete()
          .eq('fecha', fechaGlobalISO)
          .select('id');

        if (errDel) {
          console.error('Error eliminando ventas por fecha:', errDel);
          throw errDel;
        }

        const deletedCount = Array.isArray(deletedRows) ? deletedRows.length : 0;
        return res.status(200).json({
          mensaje: `Eliminadas ${deletedCount} fila(s) de la fecha ${fechaGlobalISO}`,
          deletedCount,
          deletedIds: deletedRows ? deletedRows.map(r => r.id) : []
        });
      }

      // Si vienen productos y también fechaGlobalISO -> cancelación por producto en esa fecha
      if (productosPresentes && fechaGlobalISO) {
        // Validaciones de input
        for (const item of productos) {
          if (!item.producto_id || typeof item.cantidad !== 'number' || item.cantidad <= 0) {
            return res.status(400).json({ error: 'Cada producto necesita producto_id y cantidad (número > 0) para cancelar' });
          }
        }

        // 1) Verificar disponibilidad para todos los productos primero (operación "todo o nada")
        const insuficientes = [];
        const disponibilidadMap = {}; // producto_id -> { totalDisponible, filas: [...] }

        for (const item of productos) {
          const { data: filasVentas = [], error: errSelect } = await supabase
            .from('ventas')
            .select('*')
            .eq('producto_id', item.producto_id)
            .eq('fecha', fechaGlobalISO)
            .order('hora', { ascending: false }); // de más reciente a más antiguo

          if (errSelect) {
            console.error('Error seleccionando ventas para cancelar (por fecha):', errSelect);
            throw errSelect;
          }

          const totalDisponible = (filasVentas || []).reduce((s, f) => s + (Number(f.cantidad) || 0), 0);
          disponibilidadMap[item.producto_id] = { totalDisponible, filasVentas };

          if (totalDisponible < item.cantidad) {
            insuficientes.push({
              producto_id: item.producto_id,
              solicitado: item.cantidad,
              disponible: totalDisponible
            });
          }

          // Si no existe ninguna fila para ese producto en la fecha, también tratar como insuficiente
          if ((filasVentas || []).length === 0) {
            insuficientes.push({
              producto_id: item.producto_id,
              solicitado: item.cantidad,
              disponible: 0
            });
          }
        }

        if (insuficientes.length > 0) {
          // No hacemos ninguna modificación — informamos qué productos no alcanzan
          // Mensaje solicitado por el usuario: "No se encontraron productos con tales criterios"
          return res.status(400).json({
            error: 'No se encontraron productos con tales criterios',
            detalles: insuficientes
          });
        }

        // 2) Si hay suficiente para todos, procedemos a eliminar/ajustar por producto,
        //    iterando por filas (de hora más reciente a más antigua) hasta cubrir la cantidad.
        const resultados = [];

        for (const item of productos) {
          let cantidadAEliminar = Number(item.cantidad);
          const filasVentas = disponibilidadMap[item.producto_id].filasVentas || [];

          let deletedIds = [];
          let updated = [];

          for (const fila of filasVentas) {
            if (cantidadAEliminar <= 0) break;

            const filaCantidad = Number(fila.cantidad) || 0;

            if (filaCantidad > cantidadAEliminar) {
              // actualizar fila con nueva cantidad (resta parcial)
              const nuevaCantidad = filaCantidad - cantidadAEliminar;

              const { data: updatedRow, error: errUpdate } = await supabase
                .from('ventas')
                .update({ cantidad: nuevaCantidad })
                .eq('id', fila.id)
                .select('id, cantidad');

              if (errUpdate) {
                console.error('Error actualizando fila durante cancelación por fecha:', errUpdate);
                throw errUpdate;
              }

              updated.push({ id: fila.id, antes: filaCantidad, despues: nuevaCantidad });
              cantidadAEliminar = 0;
              break;
            } else {
              // eliminar fila completa
              const { data: delData, error: errDelete } = await supabase
                .from('ventas')
                .delete()
                .eq('id', fila.id)
                .select('id, cantidad');

              if (errDelete) {
                console.error('Error eliminando fila durante cancelación por fecha:', errDelete);
                throw errDelete;
              }

              deletedIds.push(fila.id);
              cantidadAEliminar -= filaCantidad;
            }
          }

          resultados.push({
            producto_id: item.producto_id,
            solicitadas: item.cantidad,
            deletedCount: deletedIds.length,
            deletedIds,
            updatedCount: updated.length,
            updated
          });
        }

        return res.status(200).json({
          mensaje: 'Cancelación por fecha y productos realizada correctamente',
          fecha: fechaGlobalISO,
          resultados
        });
      }

      // Si vienen productos pero NO viene fechaGlobalISO -> comportamiento anterior (compatibilidad)
      if (Array.isArray(productos) && productos.length > 0 && !fechaGlobalISO) {
        // Reutilizamos la lógica previa: primero validar disponibilidad total para cada producto (todo o nada)
        const insuficientes = [];

        for (const item of productos) {
          if (!item.producto_id || typeof item.cantidad !== 'number' || item.cantidad <= 0) {
            return res.status(400).json({ error: 'Cada producto necesita producto_id y cantidad (número > 0) para cancelar' });
          }

          const { data: filasVentas = [], error: errSelect } = await supabase
            .from('ventas')
            .select('*')
            .eq('producto_id', item.producto_id)
            .order('fecha', { ascending: true })
            .order('hora', { ascending: true });

          if (errSelect) {
            console.error('Error seleccionando ventas para cancelar:', errSelect);
            throw errSelect;
          }

          const totalDisponible = (filasVentas || []).reduce((s, f) => s + (Number(f.cantidad) || 0), 0);

          if (totalDisponible < item.cantidad) {
            insuficientes.push({
              producto_id: item.producto_id,
              solicitado: item.cantidad,
              disponible: totalDisponible
            });
          }
        }

        if (insuficientes.length > 0) {
          return res.status(400).json({
            error: 'No se encontraron productos con tales criterios',
            detalles: insuficientes
          });
        }

        // Si hay suficiente, proceder
        const resultados = [];
        for (const item of productos) {
          let cantidadAEliminar = item.cantidad;

          const { data: filasVentas = [], error: errSelect } = await supabase
            .from('ventas')
            .select('*')
            .eq('producto_id', item.producto_id)
            .order('fecha', { ascending: true })
            .order('hora', { ascending: true });

          if (errSelect) {
            console.error('Error seleccionando ventas para cancelar (sin fecha):', errSelect);
            throw errSelect;
          }

          let deletedIds = [];
          let updated = [];

          for (const fila of filasVentas) {
            if (cantidadAEliminar <= 0) break;

            const filaCantidad = Number(fila.cantidad) || 0;
            if (filaCantidad > cantidadAEliminar) {
              const nuevaCantidad = filaCantidad - cantidadAEliminar;

              const { data: updatedRow, error: errUpdate } = await supabase
                .from('ventas')
                .update({ cantidad: nuevaCantidad })
                .eq('id', fila.id)
                .select('id, cantidad');

              if (errUpdate) throw errUpdate;

              updated.push({ id: fila.id, antes: filaCantidad, despues: nuevaCantidad });
              cantidadAEliminar = 0;
              break;
            } else {
              const { data: delData, error: errDelete } = await supabase
                .from('ventas')
                .delete()
                .eq('id', fila.id)
                .select('id, cantidad');

              if (errDelete) throw errDelete;

              deletedIds.push(fila.id);
              cantidadAEliminar -= filaCantidad;
            }
          }

          resultados.push({
            producto_id: item.producto_id,
            solicitadas: item.cantidad,
            deletedCount: deletedIds.length,
            deletedIds,
            updatedCount: updated.length,
            updated
          });
        }

        return res.status(200).json({
          mensaje: 'Cancelación por productos (sin fecha) realizada correctamente',
          resultados
        });
      }

      // Si llegamos aquí, no se reconoció el patrón de entrada
      return res.status(400).json({
        error: 'Solicitud de cancelación no reconocida. Enviar "fecha" para borrar todo el día (sin campo productos) o enviar "fecha" + "productos" para cancelar por producto en esa fecha.'
      });
    } else {
      return res.status(400).json({ error: 'Acción no reconocida. Use "registrar" o "cancelar"' });
    }
  } catch (err) {
    console.error('Error en la operación:', err);
    return res.status(500).json({ error: 'Error al procesar la operación', detalles: err.message || err });
  }
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
