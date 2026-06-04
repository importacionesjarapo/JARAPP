// src/dashboard/chartBuilders.js
// Utilidades de Chart.js para JARAPP Dashboard 360°
// ─────────────────────────────────────────────────────────────────────────────
// Importar: import { buildBarChart, buildDonut, ... } from '../dashboard/chartBuilders.js';

import Chart from 'chart.js/auto';
import { formatCOP } from '../utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES DE COLOR
// ─────────────────────────────────────────────────────────────────────────────
export const CC = {
    ingresos:   '#22c55e',
    gastosOp:   '#ef4444',
    comprasUSA: '#eab308',
    utilidad:   '#3b82f6',
    margen:     '#8b5cf6',
    proyeccion: '#94a3b8',
    alerta:     '#f97316',
    neutro:     '#64748b',
    palette: [
        '#4CC9F0', '#06D6A0', '#FFB703', '#A78BFA', '#E63946',
        '#F472B6', '#2DD4BF', '#FB923C', '#34D399', '#818CF8',
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS GLOBALES
// ─────────────────────────────────────────────────────────────────────────────
export const setupChartDefaults = () => {
    const tc = getThemeColors();
    Chart.defaults.color                        = tc.text;
    Chart.defaults.font.family                  = "'Inter', 'system-ui', sans-serif";
    Chart.defaults.font.size                    = 12;
    Chart.defaults.animation.duration           = 600;
    Chart.defaults.animation.easing             = 'easeOutQuart';
    Chart.defaults.plugins.legend.labels.color  = tc.text;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
    // NOTA: NO mutar Chart.defaults.scale.grid ni Chart.defaults.scale.ticks
    // en Chart.js v4 — esas propiedades son proxies que causan stack overflow.
    // Los colores de grid y ticks se pasan directamente en cada builder.
};

// ─────────────────────────────────────────────────────────────────────────────
// COLORES DE TEMA
// ─────────────────────────────────────────────────────────────────────────────
export const getThemeColors = () => {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    return {
        text:       light ? 'rgba(15,23,42,0.85)'  : 'rgba(255,255,255,0.85)',
        subtext:    light ? 'rgba(15,23,42,0.50)'  : 'rgba(255,255,255,0.50)',
        grid:       light ? 'rgba(0,0,0,0.08)'     : 'rgba(255,255,255,0.12)',
        tooltipBg:  light ? '#FFFFFF'              : '#0F172A',
        tooltipBdr: light ? 'rgba(0,0,0,0.12)'    : 'rgba(255,255,255,0.15)',
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// TOOLTIP COP PERSONALIZADO
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Genera la configuración de tooltip para Chart.js.
 * @param {Array<{label:string, getValue:(ctx)=>string}>} extraLines
 *   Líneas adicionales calculadas (p.ej. utilidad derivada).
 * @returns {Object} — objeto para plugins.tooltip
 */
export const makeCOPTooltip = (extraLines = []) => {
    const tc = getThemeColors();
    return {
        enabled: true,
        backgroundColor: tc.tooltipBg,
        borderColor:     tc.tooltipBdr,
        borderWidth:     1,
        titleColor:      tc.text,
        bodyColor:       tc.subtext,
        padding:         12,
        cornerRadius:    10,
        displayColors:   true,
        boxPadding:      4,
        callbacks: {
            title(items) {
                return items[0]?.label ?? '';
            },
            label(ctx) {
                const raw   = ctx.raw;
                const dsLabel = ctx.dataset?.label ?? '';
                // Formatear valores numéricos grandes como COP
                let valStr = '';
                if (typeof raw === 'object' && raw !== null && 'x' in raw && 'y' in raw) {
                    // Scatter / Bubble
                    valStr = `X: ${Math.abs(raw.x) >= 1000 ? formatCOP(raw.x) : raw.x}  Y: ${Math.abs(raw.y) >= 1000 ? formatCOP(raw.y) : raw.y}`;
                } else if (typeof raw === 'number') {
                    valStr = Math.abs(raw) >= 1000 ? formatCOP(raw) : raw.toLocaleString('es-CO');
                } else {
                    valStr = String(raw ?? '');
                }
                return `  ${dsLabel}: ${valStr}`;
            },
            afterBody(items) {
                if (!extraLines.length) return [];
                const ctx = items[0];
                return extraLines.map(el => `  ${el.label}: ${el.getValue(ctx)}`);
            },
        },
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// DESTROY HELPERS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Destruye el Chart.js asociado a un canvas específico.
 * @param {string} canvasId
 */
export const destroyChart = (canvasId) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    // Chart.js ≥ 3 almacena la instancia en el canvas como propiedad interna
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
};

/**
 * Destruye TODAS las instancias de Chart.js activas.
 */
export const destroyAllCharts = () => {
    Object.values(Chart.instances).forEach(c => {
        try { c.destroy(); } catch (_) { /* ignorar */ }
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER INTERNO — Opciones base compartidas
// ─────────────────────────────────────────────────────────────────────────────
const _baseOpts = (extraLines = []) => ({
    responsive:          true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: {
        tooltip: makeCOPTooltip(extraLines),
        legend: { display: true, position: 'bottom' },
    },
});

// Helper: agrega línea de referencia horizontal como anotación nativa
// (sin plugin externo — usa afterDraw en Chart.js)
const _addRefLinePlugin = (y, label, color = CC.alerta) => ({
    id: `refLine_${Math.random().toString(36).slice(2)}`,
    afterDraw(chart) {
        const { ctx, chartArea: ca, scales } = chart;
        const yScale = scales.y ?? scales.y1;
        if (!yScale || !ca) return;
        const yPx = yScale.getPixelForValue(y);
        if (yPx < ca.top || yPx > ca.bottom) return;
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(ca.left,  yPx);
        ctx.lineTo(ca.right, yPx);
        ctx.stroke();
        ctx.fillStyle    = color;
        ctx.font         = '11px Inter, system-ui, sans-serif';
        ctx.textAlign    = 'right';
        ctx.fillText(label ?? String(y), ca.right - 4, yPx - 4);
        ctx.restore();
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. BAR CHART (vertical, opcionalmente apilado)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string}  canvasId
 * @param {string[]} labels
 * @param {Array}   datasets   — Datasets estándar de Chart.js
 * @param {Object}  options
 *   @param {boolean} options.stacked         — Apilar barras
 *   @param {{y,label,color}} options.refLine — Línea de referencia
 *   @param {string}  options.title
 *   @param {boolean} options.showLegend
 *   @param {Array}   options.extraTooltipLines
 * @returns {Chart}
 */
export const buildBarChart = (canvasId, labels, datasets, options = {}) => {
    destroyChart(canvasId);
    setupChartDefaults();
    const tc = getThemeColors();

    const plugins = [];
    if (options.refLine) {
        plugins.push(_addRefLinePlugin(options.refLine.y, options.refLine.label, options.refLine.color ?? CC.alerta));
    }

    const chart = new Chart(document.getElementById(canvasId), {
        type: 'bar',
        data: { labels, datasets },
        options: {
            ..._baseOpts(options.extraTooltipLines),
            plugins: {
                ..._baseOpts().plugins,
                tooltip: makeCOPTooltip(options.extraTooltipLines ?? []),
                legend:  { display: options.showLegend !== false, position: 'bottom', labels: { color: tc.text } },
                title:   options.title ? { display: true, text: options.title, color: tc.text, font: { size: 14, weight: '600' } } : { display: false },
            },
            scales: {
                x: {
                    stacked: !!options.stacked,
                    grid:    { color: tc.grid },
                    ticks:   { color: tc.subtext },
                },
                y: {
                    stacked: !!options.stacked,
                    grid:    { color: tc.grid },
                    ticks:   { color: tc.subtext, callback: (v) => Math.abs(v) >= 1000 ? formatCOP(v) : v },
                },
            },
        },
        plugins,
    });

    return chart;
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. COMPOSED CHART (bar + line, doble eje Y opcional)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string}   canvasId
 * @param {string[]} labels
 * @param {Array}    barDatasets   — datasets tipo 'bar'
 * @param {Array}    lineDatasets  — datasets tipo 'line'
 * @param {Object}   options
 *   @param {boolean} options.dualY        — Habilitar eje Y secundario (yAxisID: 'y1')
 *   @param {{y,label,color}} options.refLine  — Línea de referencia en Y principal
 *   @param {{y,label,color}} options.refLine1 — Línea de referencia en Y secundario
 * @returns {Chart}
 */
export const buildComposedChart = (canvasId, labels, barDatasets, lineDatasets, options = {}) => {
    destroyChart(canvasId);
    setupChartDefaults();
    const tc = getThemeColors();

    const mergedDatasets = [
        ...barDatasets.map(ds  => ({ ...ds, type: 'bar',  yAxisID: ds.yAxisID ?? 'y'  })),
        ...lineDatasets.map(ds => ({ ...ds, type: 'line', yAxisID: ds.yAxisID ?? (options.dualY ? 'y1' : 'y'), tension: ds.tension ?? 0.4, pointRadius: ds.pointRadius ?? 4 })),
    ];

    const plugins = [];
    if (options.refLine)  plugins.push(_addRefLinePlugin(options.refLine.y,  options.refLine.label,  options.refLine.color  ?? CC.alerta));
    if (options.refLine1) plugins.push(_addRefLinePlugin(options.refLine1.y, options.refLine1.label, options.refLine1.color ?? CC.margen));

    const scales = {
        x:  { grid: { color: tc.grid }, ticks: { color: tc.subtext } },
        y:  { position: 'left',  grid: { color: tc.grid }, ticks: { color: tc.subtext, callback: (v) => Math.abs(v) >= 1000 ? formatCOP(v) : v } },
    };
    if (options.dualY) {
        scales.y1 = {
            position: 'right',
            grid:     { drawOnChartArea: false },
            ticks:    { color: tc.subtext, callback: (v) => `${v}%` },
        };
    }

    const chart = new Chart(document.getElementById(canvasId), {
        type: 'bar',
        data: { labels, datasets: mergedDatasets },
        options: {
            ..._baseOpts(options.extraTooltipLines),
            plugins: {
                ..._baseOpts().plugins,
                tooltip: makeCOPTooltip(options.extraTooltipLines ?? []),
                legend:  { display: options.showLegend !== false, position: 'bottom', labels: { color: tc.text } },
                title:   options.title ? { display: true, text: options.title, color: tc.text, font: { size: 14, weight: '600' } } : { display: false },
            },
            scales,
        },
        plugins,
    });

    return chart;
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. AREA CHART (línea con relleno degradado)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string}   canvasId
 * @param {string[]} labels
 * @param {Array}    datasets  — se les añade fill + gradient automáticamente
 * @param {Object}   options
 *   @param {Array<{y,color,label}>} options.bands — Bandas de riesgo horizontales
 * @returns {Chart}
 */
export const buildAreaChart = (canvasId, labels, datasets, options = {}) => {
    destroyChart(canvasId);
    setupChartDefaults();
    const tc = getThemeColors();

    // Plugin de gradiente: se genera en beforeDatasetsDraw
    const gradientPlugin = {
        id: 'areaGradient',
        beforeDatasetsDraw(chart) {
            const { ctx, chartArea: ca } = chart;
            if (!ca) return;
            chart.data.datasets.forEach((ds, i) => {
                if (ds._gradientApplied) return;
                const meta = chart.getDatasetMeta(i);
                if (!meta.dataset) return;
                const color = ds.borderColor ?? CC.palette[i % CC.palette.length];
                const grad  = ctx.createLinearGradient(0, ca.top, 0, ca.bottom);
                grad.addColorStop(0,   hexAlpha(color, 0.35));
                grad.addColorStop(1,   hexAlpha(color, 0.02));
                ds.backgroundColor    = grad;
                ds._gradientApplied   = true;
                chart.update('none');
            });
        },
    };

    // Plugin de bandas de riesgo
    const bandsPlugin = Array.isArray(options.bands) && options.bands.length > 0
        ? {
            id: 'areaBands',
            afterDraw(chart) {
                const { ctx, chartArea: ca, scales } = chart;
                const yScale = scales.y;
                if (!yScale || !ca) return;
                options.bands.forEach(band => {
                    const yPx = yScale.getPixelForValue(band.y);
                    if (yPx < ca.top || yPx > ca.bottom) return;
                    ctx.save();
                    ctx.fillStyle = hexAlpha(band.color ?? CC.alerta, 0.08);
                    ctx.fillRect(ca.left, yPx, ca.right - ca.left, ca.bottom - yPx);
                    ctx.strokeStyle = hexAlpha(band.color ?? CC.alerta, 0.45);
                    ctx.lineWidth   = 1;
                    ctx.setLineDash([5, 4]);
                    ctx.beginPath();
                    ctx.moveTo(ca.left, yPx);
                    ctx.lineTo(ca.right, yPx);
                    ctx.stroke();
                    ctx.fillStyle = band.color ?? CC.alerta;
                    ctx.font      = '10px Inter, system-ui';
                    ctx.textAlign = 'left';
                    ctx.fillText(band.label ?? '', ca.left + 6, yPx - 4);
                    ctx.restore();
                });
            },
        }
        : null;

    const processedDatasets = datasets.map((ds, i) => ({
        ...ds,
        fill:    ds.fill !== undefined ? ds.fill : true,
        tension: ds.tension ?? 0.4,
        borderColor:     ds.borderColor ?? CC.palette[i % CC.palette.length],
        backgroundColor: 'transparent', // se reemplaza por gradiente en el plugin
        pointRadius:     ds.pointRadius ?? 3,
        pointHoverRadius:ds.pointHoverRadius ?? 6,
    }));

    const plugins = [gradientPlugin];
    if (bandsPlugin) plugins.push(bandsPlugin);

    const chart = new Chart(document.getElementById(canvasId), {
        type: 'line',
        data: { labels, datasets: processedDatasets },
        options: {
            ..._baseOpts(options.extraTooltipLines),
            plugins: {
                ..._baseOpts().plugins,
                tooltip: makeCOPTooltip(options.extraTooltipLines ?? []),
                legend:  { display: options.showLegend !== false, position: 'bottom', labels: { color: tc.text } },
                title:   options.title ? { display: true, text: options.title, color: tc.text, font: { size: 14, weight: '600' } } : { display: false },
            },
            scales: {
                x: { grid: { color: tc.grid }, ticks: { color: tc.subtext } },
                y: { grid: { color: tc.grid }, ticks: { color: tc.subtext, callback: (v) => Math.abs(v) >= 1000 ? formatCOP(v) : v } },
            },
        },
        plugins,
    });

    return chart;
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. HORIZONTAL BAR CHART
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string}   canvasId
 * @param {string[]} labels
 * @param {Array}    datasets
 * @param {Object}   options
 *   @param {boolean} options.rightValueLabels — Etiquetas de valor al final de cada barra
 * @returns {Chart}
 */
export const buildHorizontalBar = (canvasId, labels, datasets, options = {}) => {
    destroyChart(canvasId);
    setupChartDefaults();
    const tc = getThemeColors();

    const valueLabelsPlugin = options.rightValueLabels
        ? {
            id: 'hBarValueLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                chart.data.datasets.forEach((ds, i) => {
                    const meta = chart.getDatasetMeta(i);
                    meta.data.forEach((bar, j) => {
                        const val = ds.data[j];
                        if (val == null) return;
                        const { x, y } = bar.tooltipPosition();
                        const label = Math.abs(val) >= 1000 ? formatCOP(val) : val.toLocaleString('es-CO');
                        ctx.save();
                        ctx.fillStyle  = tc.text;
                        ctx.font       = '11px Inter, system-ui';
                        ctx.textAlign  = 'left';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(label, x + 6, y);
                        ctx.restore();
                    });
                });
            },
        }
        : null;

    const plugins = valueLabelsPlugin ? [valueLabelsPlugin] : [];

    const chart = new Chart(document.getElementById(canvasId), {
        type: 'bar',
        data: { labels, datasets },
        options: {
            ..._baseOpts(options.extraTooltipLines),
            indexAxis: 'y',
            plugins: {
                ..._baseOpts().plugins,
                tooltip: makeCOPTooltip(options.extraTooltipLines ?? []),
                legend:  { display: options.showLegend !== false, position: 'bottom', labels: { color: tc.text } },
                title:   options.title ? { display: true, text: options.title, color: tc.text, font: { size: 14, weight: '600' } } : { display: false },
            },
            scales: {
                x: { grid: { color: tc.grid }, ticks: { color: tc.subtext, callback: (v) => Math.abs(v) >= 1000 ? formatCOP(v) : v } },
                y: { grid: { color: 'transparent' }, ticks: { color: tc.subtext } },
            },
        },
        plugins,
    });

    return chart;
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. SCATTER / BUBBLE CHART
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string} canvasId
 * @param {Array<{x:number, y:number, r?:number, label?:string, color?:string}>} points
 * @param {Object} options
 *   @param {{xMid,yMid}} options.quadrants — Líneas de cuadrante
 * @returns {Chart}
 */
export const buildScatter = (canvasId, points, options = {}) => {
    destroyChart(canvasId);
    setupChartDefaults();
    const tc = getThemeColors();

    const isBubble = points.some(p => p.r != null && p.r > 0);

    const dataset = {
        label:           options.datasetLabel ?? 'Datos',
        data:            points.map(p => ({ x: p.x, y: p.y, r: p.r ?? 6, label: p.label ?? '' })),
        backgroundColor: points.map((p, i) => hexAlpha(p.color ?? CC.palette[i % CC.palette.length], 0.75)),
        borderColor:     points.map((p, i) => p.color ?? CC.palette[i % CC.palette.length]),
        borderWidth:     1.5,
    };

    // Plugin de cuadrantes
    const quadPlugin = options.quadrants
        ? {
            id: 'quadrantLines',
            afterDraw(chart) {
                const { ctx, chartArea: ca, scales } = chart;
                if (!ca || !scales.x || !scales.y) return;
                const xPx = scales.x.getPixelForValue(options.quadrants.xMid);
                const yPx = scales.y.getPixelForValue(options.quadrants.yMid);
                ctx.save();
                ctx.strokeStyle = tc.grid;
                ctx.lineWidth   = 1.5;
                ctx.setLineDash([5, 4]);
                // Línea vertical
                ctx.beginPath(); ctx.moveTo(xPx, ca.top); ctx.lineTo(xPx, ca.bottom); ctx.stroke();
                // Línea horizontal
                ctx.beginPath(); ctx.moveTo(ca.left, yPx); ctx.lineTo(ca.right, yPx); ctx.stroke();
                ctx.restore();
            },
        }
        : null;

    // Plugin de etiquetas de puntos
    const labelPlugin = {
        id: 'scatterLabels',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const meta = chart.getDatasetMeta(0);
            meta.data.forEach((pt, i) => {
                const raw = points[i];
                if (!raw?.label) return;
                ctx.save();
                ctx.fillStyle    = tc.subtext;
                ctx.font         = '10px Inter, system-ui';
                ctx.textAlign    = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(raw.label, pt.x, pt.y - (raw.r ?? 6) - 2);
                ctx.restore();
            });
        },
    };

    const plugins = [labelPlugin];
    if (quadPlugin) plugins.push(quadPlugin);

    const chart = new Chart(document.getElementById(canvasId), {
        type: isBubble ? 'bubble' : 'scatter',
        data: { datasets: [dataset] },
        options: {
            ..._baseOpts(options.extraTooltipLines),
            plugins: {
                ..._baseOpts().plugins,
                tooltip: {
                    ...makeCOPTooltip(options.extraTooltipLines ?? []),
                    callbacks: {
                        label(ctx) {
                            const raw   = ctx.raw;
                            const label = points[ctx.dataIndex]?.label ?? '';
                            const x     = Math.abs(raw.x) >= 1000 ? formatCOP(raw.x) : raw.x.toLocaleString('es-CO');
                            const y     = Math.abs(raw.y) >= 1000 ? formatCOP(raw.y) : raw.y.toLocaleString('es-CO');
                            return `  ${label || 'Punto'}: (${x}, ${y})${isBubble && raw.r ? `  r=${raw.r}` : ''}`;
                        },
                    },
                },
                legend: { display: false },
            },
            scales: {
                x: { grid: { color: tc.grid }, ticks: { color: tc.subtext, callback: (v) => Math.abs(v) >= 1000 ? formatCOP(v) : v } },
                y: { grid: { color: tc.grid }, ticks: { color: tc.subtext, callback: (v) => Math.abs(v) >= 1000 ? formatCOP(v) : v } },
            },
        },
        plugins,
    });

    return chart;
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. RADAR CHART
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string}   canvasId
 * @param {string[]} labels
 * @param {Array}    datasets
 * @param {Object}   options
 * @returns {Chart}
 */
export const buildRadar = (canvasId, labels, datasets, options = {}) => {
    destroyChart(canvasId);
    setupChartDefaults();
    const tc = getThemeColors();

    const processedDatasets = datasets.map((ds, i) => ({
        ...ds,
        fill:            ds.fill !== undefined ? ds.fill : (i === 0),
        borderColor:     ds.borderColor ?? CC.palette[i % CC.palette.length],
        backgroundColor: ds.backgroundColor ?? hexAlpha(CC.palette[i % CC.palette.length], 0.2),
        pointBackgroundColor: ds.borderColor ?? CC.palette[i % CC.palette.length],
        pointRadius:     4,
        pointHoverRadius:6,
    }));

    const chart = new Chart(document.getElementById(canvasId), {
        type: 'radar',
        data: { labels, datasets: processedDatasets },
        options: {
            ..._baseOpts(options.extraTooltipLines),
            plugins: {
                ..._baseOpts().plugins,
                tooltip: makeCOPTooltip(options.extraTooltipLines ?? []),
                legend:  { display: options.showLegend !== false, position: 'bottom', labels: { color: tc.text } },
                title:   options.title ? { display: true, text: options.title, color: tc.text, font: { size: 14 } } : { display: false },
            },
            scales: {
                r: {
                    min:         options.min ?? 0,
                    max:         options.max ?? 100,
                    ticks: {
                        stepSize:     options.stepSize ?? 20,
                        color:        tc.subtext,
                        backdropColor:'transparent',
                    },
                    grid:        { color: tc.grid },
                    angleLines:  { color: tc.grid },
                    pointLabels: { color: tc.text, font: { size: 11, weight: '600' } },
                },
            },
        },
    });

    return chart;
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. WATERFALL CHART (barras flotantes)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string} canvasId
 * @param {Array<{label:string, value:number, type:'total'|'add'|'subtract'}>} steps
 * @param {Object} options
 * @returns {Chart}
 */
export const buildWaterfall = (canvasId, steps, options = {}) => {
    destroyChart(canvasId);
    setupChartDefaults();
    const tc = getThemeColors();

    if (!Array.isArray(steps) || steps.length === 0) {
        console.warn('[chartBuilders] buildWaterfall: steps vacíos');
        return null;
    }

    // Calcular posiciones flotantes (valor base acumulado)
    let acum = 0;
    const floatData  = [];
    const colors     = [];
    const tooltipVals= [];

    steps.forEach((step) => {
        const val = parseFloat(step.value ?? 0);
        if (step.type === 'total') {
            // Barra desde 0 hasta el acumulado actual (reinicia perspectiva)
            floatData.push([0, acum]);
            colors.push(hexAlpha(acum >= 0 ? CC.ingresos : CC.gastosOp, 0.85));
            tooltipVals.push(acum);
        } else if (step.type === 'add') {
            floatData.push([acum, acum + val]);
            colors.push(hexAlpha(CC.ingresos, 0.85));
            acum += val;
            tooltipVals.push(val);
        } else {
            // subtract
            const prev = acum;
            floatData.push([acum + val, acum]);
            colors.push(hexAlpha(CC.gastosOp, 0.85));
            acum += val; // val ya viene negativo en substract, o se resta
            tooltipVals.push(val);
        }
    });

    // Plugin de etiqueta de valor sobre cada barra
    const valueLabelsPlugin = {
        id: 'waterfallLabels',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const meta = chart.getDatasetMeta(0);
            meta.data.forEach((bar, i) => {
                const val = tooltipVals[i];
                if (val == null) return;
                const label = Math.abs(val) >= 1000 ? formatCOP(val) : val.toLocaleString('es-CO');
                const { x } = bar.tooltipPosition();
                const top   = Math.min(bar.base, bar.y);
                ctx.save();
                ctx.fillStyle    = tc.text;
                ctx.font         = 'bold 11px Inter, system-ui';
                ctx.textAlign    = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(label, x, top - 4);
                ctx.restore();
            });
        },
    };

    const chart = new Chart(document.getElementById(canvasId), {
        type: 'bar',
        data: {
            labels: steps.map(s => s.label),
            datasets: [{
                label:           options.datasetLabel ?? 'Flujo',
                data:            floatData,
                backgroundColor: colors,
                borderColor:     colors.map(c => c.replace(/,[\d.]+\)$/, ',1)')),
                borderWidth:     1,
                borderRadius:    4,
                borderSkipped:   false,
            }],
        },
        options: {
            ..._baseOpts(),
            plugins: {
                ..._baseOpts().plugins,
                tooltip: {
                    ...makeCOPTooltip(),
                    callbacks: {
                        label(ctx) {
                            const val = tooltipVals[ctx.dataIndex];
                            return `  ${steps[ctx.dataIndex].label}: ${Math.abs(val ?? 0) >= 1000 ? formatCOP(val ?? 0) : (val ?? 0).toLocaleString('es-CO')}`;
                        },
                    },
                },
                legend: { display: false },
                title:  options.title ? { display: true, text: options.title, color: tc.text, font: { size: 14, weight: '600' } } : { display: false },
            },
            scales: {
                x: { grid: { color: 'transparent' }, ticks: { color: tc.subtext } },
                y: { grid: { color: tc.grid }, ticks: { color: tc.subtext, callback: (v) => Math.abs(v) >= 1000 ? formatCOP(v) : v } },
            },
        },
        plugins: [valueLabelsPlugin],
    });

    return chart;
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. DONUT CHART (con texto central en canvas2d nativo)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string}   canvasId
 * @param {string[]} labels
 * @param {number[]} data
 * @param {string[]} colors     — Array de colores hex/rgb (usa CC.palette si es vacío)
 * @param {Object}   options
 *   @param {string}  options.centerText      — Línea principal en el centro
 *   @param {string}  options.centerSubtext   — Línea secundaria (más pequeña)
 *   @param {string}  options.cutout          — Porcentaje de recorte (default '65%')
 * @returns {Chart}
 */
export const buildDonut = (canvasId, labels, data, colors = [], options = {}) => {
    destroyChart(canvasId);
    setupChartDefaults();
    const tc = getThemeColors();

    const palette   = colors.length > 0 ? colors : CC.palette;
    const cutout    = options.cutout ?? '65%';
    const centerTxt = options.centerText    ?? '';
    const centerSub = options.centerSubtext ?? '';

    // Plugin de texto central (canvas2d nativo — sin dependencias externas)
    const centerTextPlugin = (centerTxt || centerSub)
        ? {
            id: 'donutCenterText',
            afterDatasetsDraw(chart) {
                const { ctx, chartArea: ca } = chart;
                if (!ca) return;
                const cx = (ca.left + ca.right)  / 2;
                const cy = (ca.top  + ca.bottom) / 2;

                ctx.save();
                ctx.textAlign    = 'center';
                ctx.textBaseline = 'middle';

                if (centerTxt && centerSub) {
                    // Dos líneas: principal + subtexto
                    ctx.font      = `bold 18px Inter, system-ui, sans-serif`;
                    ctx.fillStyle = tc.text;
                    ctx.fillText(centerTxt, cx, cy - 11);

                    ctx.font      = `12px Inter, system-ui, sans-serif`;
                    ctx.fillStyle = tc.subtext;
                    ctx.fillText(centerSub, cx, cy + 11);
                } else {
                    ctx.font      = `bold 16px Inter, system-ui, sans-serif`;
                    ctx.fillStyle = tc.text;
                    ctx.fillText(centerTxt || centerSub, cx, cy);
                }

                ctx.restore();
            },
        }
        : null;

    const plugins = centerTextPlugin ? [centerTextPlugin] : [];

    const chart = new Chart(document.getElementById(canvasId), {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor:      palette.slice(0, data.length).map(c => hexAlpha(c, 0.85)),
                borderColor:          palette.slice(0, data.length),
                borderWidth:          2,
                hoverOffset:          8,
                hoverBorderWidth:     3,
            }],
        },
        options: {
            ..._baseOpts(options.extraTooltipLines),
            cutout,
            plugins: {
                ..._baseOpts().plugins,
                tooltip: makeCOPTooltip(options.extraTooltipLines ?? []),
                legend:  {
                    display:  options.showLegend !== false,
                    position: options.legendPosition ?? 'bottom',
                    labels:   { color: tc.text, padding: 14, usePointStyle: true },
                },
                title: options.title
                    ? { display: true, text: options.title, color: tc.text, font: { size: 14, weight: '600' } }
                    : { display: false },
            },
        },
        plugins,
    });

    return chart;
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER INTERNO — Convertir color hex a rgba con alpha
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Convierte un color hex '#RRGGBB' o '#RGB' a 'rgba(r,g,b,alpha)'.
 * Si ya es rgba/rgb/hsl, lo devuelve tal cual con el alpha aplicado si es posible.
 */
function hexAlpha(hex, alpha = 1) {
    if (!hex || typeof hex !== 'string') return `rgba(100,116,139,${alpha})`;
    const h = hex.trim();

    // Ya es rgba/rgb
    if (h.startsWith('rgba') || h.startsWith('rgb')) {
        // Reemplazar alpha si está en forma rgba
        if (h.startsWith('rgba')) {
            return h.replace(/,\s*[\d.]+\)$/, `,${alpha})`);
        }
        return h.replace('rgb', 'rgba').replace(')', `,${alpha})`);
    }

    // Hex corto #RGB
    if (h.length === 4) {
        const r = parseInt(h[1] + h[1], 16);
        const g = parseInt(h[2] + h[2], 16);
        const b = parseInt(h[3] + h[3], 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    // Hex estándar #RRGGBB
    if (h.length === 7) {
        const r = parseInt(h.slice(1, 3), 16);
        const g = parseInt(h.slice(3, 5), 16);
        const b = parseInt(h.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    // Fallback
    return h;
}
