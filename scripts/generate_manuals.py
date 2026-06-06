#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JARAPP PDF Manual Generator - v1.0
Genera Manual Funcional y Manual Tecnico con estilos de marca Jarapo.
Uso: python scripts/generate_manuals.py
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    Image, HRFlowable, PageBreak, KeepTogether,
)
from reportlab.lib.colors import HexColor

# ── Config ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
LOGO_PATH   = os.path.join(SCRIPT_DIR, 'logo_jarapo.png')
OUTPUT_DIR  = os.path.join(PROJECT_DIR, 'docs')
PAGE_W, PAGE_H = A4
MARGIN = 2.0 * cm
DOC_W  = PAGE_W - 2 * MARGIN

# ── Colores de marca ───────────────────────────────────────────────────────────
PRIMARY   = HexColor('#E63946')
SECONDARY = HexColor('#1D3557')
SUCCESS   = HexColor('#06D6A0')
WARNING   = HexColor('#F4A261')
INFO      = HexColor('#457B9D')
LIGHT_RED = HexColor('#FEE2E2')
LIGHT_BLU = HexColor('#DBEAFE')
LIGHT_GRN = HexColor('#D1FAE5')
LIGHT_YEL = HexColor('#FEF3C7')
ROW_ALT   = HexColor('#F8F9FA')
BORDER    = HexColor('#E0E0E0')
DARK      = HexColor('#1E293B')
GREY      = HexColor('#64748B')
INFO_BG   = HexColor('#EFF6FF')
WARN_BG   = HexColor('#FFFBEB')
SUCC_BG   = HexColor('#ECFDF5')
ERR_BG    = HexColor('#FEF2F2')

os.makedirs(OUTPUT_DIR, exist_ok=True)


# ── Estilos ────────────────────────────────────────────────────────────────────
def make_styles(accent):
    def s(name, **kw):
        d = dict(fontName='Helvetica', fontSize=10, textColor=DARK, leading=14, spaceAfter=4)
        d.update(kw)
        return ParagraphStyle(name, **d)

    return {
        'normal':       s('normal'),
        'bold':         s('bold',        fontName='Helvetica-Bold'),
        'small':        s('small',       fontSize=8, textColor=GREY, leading=12),
        'h1':           s('h1',          fontName='Helvetica-Bold', fontSize=15, textColor=accent,
                          spaceAfter=6, spaceBefore=14),
        'h2':           s('h2',          fontName='Helvetica-Bold', fontSize=12, textColor=DARK,
                          spaceAfter=4, spaceBefore=10),
        'h3':           s('h3',          fontName='Helvetica-Bold', fontSize=10, textColor=accent,
                          spaceAfter=3, spaceBefore=7),
        'td':           s('td',          fontSize=8, leading=12),
        'td_bold':      s('td_bold',     fontName='Helvetica-Bold', fontSize=8, leading=12),
        'td_code':      s('td_code',     fontName='Courier', fontSize=7, textColor=SECONDARY, leading=11),
        'bullet':       s('bullet',      fontSize=9, leading=14, leftIndent=14, spaceAfter=3),
        'bullet_bold':  s('bullet_bold', fontName='Helvetica-Bold', fontSize=9, leading=14,
                          leftIndent=14, spaceAfter=3),
        'code':         s('code',        fontName='Courier', fontSize=8, textColor=SECONDARY,
                          leading=12, backColor=HexColor('#F1F5F9'), leftIndent=10, rightIndent=10),
        'caption':      s('caption',     fontSize=8, textColor=GREY, alignment=1, spaceAfter=2),
        'qa_q':         s('qa_q',        fontName='Helvetica-Bold', fontSize=9, textColor=accent,
                          leading=13, spaceAfter=2),
        'qa_a':         s('qa_a',        fontSize=9, leading=13, leftIndent=12, spaceAfter=8),
    }


# ── Helpers ────────────────────────────────────────────────────────────────────
def ctable(data, widths, hdr_bg=None):
    """Tabla con header coloreado y filas alternadas."""
    if hdr_bg is None:
        hdr_bg = PRIMARY
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1,  0), hdr_bg),
        ('TEXTCOLOR',     (0, 0), (-1,  0), colors.white),
        ('FONTNAME',      (0, 0), (-1,  0), 'Helvetica-Bold'),
        ('FONTSIZE',      (0, 0), (-1,  0), 8),
        ('FONTNAME',      (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE',      (0, 1), (-1, -1), 8),
        ('ALIGN',         (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS',(0, 1), (-1, -1), [colors.white, ROW_ALT]),
        ('GRID',          (0, 0), (-1, -1), 0.4, BORDER),
        ('LINEBELOW',     (0, 0), (-1,  0), 1.5, hdr_bg),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 6),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    return t


def info_box(items, bg=INFO_BG, border=INFO, st=None):
    """Caja de información con borde lateral izquierdo."""
    if isinstance(items, str):
        items = [items]
    content = []
    for item in items:
        if isinstance(item, str) and st:
            content.append(Paragraph(item, st['normal']))
        else:
            content.append(item)
    data = [[content]]
    t = Table(data, colWidths=[DOC_W - 0.6 * cm])
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), bg),
        ('BOX',           (0, 0), (-1, -1), 0.8, border),
        ('LINEBEFORE',    (0, 0), (0,  -1), 4, border),
        ('LEFTPADDING',   (0, 0), (-1, -1), 12),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 10),
        ('TOPPADDING',    (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    return t


def section_hdr(title, st, accent=None):
    """Encabezado de sección con líneas decorativas."""
    if accent is None:
        accent = PRIMARY
    return [
        Spacer(1, 0.4 * cm),
        HRFlowable(width=DOC_W, thickness=3, color=accent, spaceAfter=3),
        Paragraph(title, st['h1']),
        HRFlowable(width=DOC_W, thickness=0.5, color=BORDER, spaceBefore=2, spaceAfter=5),
    ]


def bullets(items, st, char='•'):
    return [Paragraph(f'{char}  {item}', st['bullet']) for item in items]


def make_page_fn(logo_path, accent, manual_name):
    """Canvas callback para encabezado y pie de página."""
    def fn(canvas, doc):
        canvas.saveState()
        # Barra superior
        canvas.setFillColor(accent)
        canvas.rect(0, PAGE_H - 1.1 * cm, PAGE_W, 1.1 * cm, fill=1, stroke=0)
        # Logo en barra
        if os.path.exists(logo_path):
            try:
                canvas.drawImage(logo_path, PAGE_W - MARGIN - 2.8 * cm,
                                 PAGE_H - 1.0 * cm,
                                 width=2.5 * cm, height=0.9 * cm,
                                 preserveAspectRatio=True, mask='auto')
            except Exception:
                pass
        # Nombre del manual en barra
        canvas.setFont('Helvetica-Bold', 7)
        canvas.setFillColor(colors.white)
        canvas.drawString(MARGIN, PAGE_H - 0.78 * cm, manual_name)
        # Número de página
        canvas.setFont('Helvetica', 7)
        canvas.setFillColor(GREY)
        canvas.drawCentredString(PAGE_W / 2, 0.65 * cm, f'Página {doc.page}')
        # Línea del pie
        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.4)
        canvas.line(MARGIN, 1.0 * cm, PAGE_W - MARGIN, 1.0 * cm)
        canvas.restoreState()
    return fn


def cover_fn(logo_path, accent, title1, title2, sub):
    """Canvas callback para portada completa."""
    def fn(canvas, doc):
        canvas.saveState()
        W, H = PAGE_W, PAGE_H
        # Fondo completo del color de acento
        canvas.setFillColor(accent)
        canvas.rect(0, 0, W, H, fill=1, stroke=0)
        # Franja blanca semitransparente superior
        canvas.setFillColor(HexColor('#FFFFFF18'))
        canvas.rect(0, H - 3.5 * cm, W, 3.5 * cm, fill=1, stroke=0)
        # Logo grande centrado
        logo_top = H * 0.65
        if os.path.exists(logo_path):
            try:
                canvas.drawImage(logo_path, W / 2 - 4.5 * cm, logo_top,
                                 width=9 * cm, height=7 * cm,
                                 preserveAspectRatio=True, mask='auto')
            except Exception:
                pass
        # Caja título semitransparente
        box_h, box_y = 6 * cm, H * 0.27
        canvas.setFillColor(HexColor('#FFFFFF14'))
        canvas.roundRect(MARGIN, box_y, W - 2 * MARGIN, box_h, 10, fill=1, stroke=0)
        # Título principal
        canvas.setFont('Helvetica-Bold', 24)
        canvas.setFillColor(colors.white)
        canvas.drawCentredString(W / 2, box_y + box_h - 1.8 * cm, title1)
        # Subtítulo
        canvas.setFont('Helvetica', 14)
        canvas.setFillColor(HexColor('#CBD5E1'))
        canvas.drawCentredString(W / 2, box_y + box_h - 3.2 * cm, title2)
        # Descripción corta
        canvas.setFont('Helvetica', 9)
        canvas.setFillColor(HexColor('#94A3B8'))
        canvas.drawCentredString(W / 2, box_y + 0.8 * cm, sub)
        # Pie de portada
        canvas.setFillColor(HexColor('#FFFFFF18'))
        canvas.rect(0, 0, W, 1.5 * cm, fill=1, stroke=0)
        canvas.setFont('Helvetica', 7)
        canvas.setFillColor(HexColor('#FFFFFF80'))
        canvas.drawCentredString(W / 2, 0.5 * cm,
                                 'JARAPP v3.0  ·  Importaciones Jarapo  ·  2026  ·  Confidencial — Uso Interno')
        canvas.restoreState()
    return fn


# ═══════════════════════════════════════════════════════════════════════════════
# MANUAL FUNCIONAL
# ═══════════════════════════════════════════════════════════════════════════════
def build_funcional():
    accent = PRIMARY
    st = make_styles(accent)
    story = []

    # ── Portada (página 1 — dibujada en canvas, story vacío) ──────────────────
    story.append(PageBreak())  # la portada es el canvas; el story empieza en pág 2

    # ── Índice rápido ──────────────────────────────────────────────────────────
    story += section_hdr('Contenido del Manual', st, accent)
    toc_data = [
        ['#', 'Sección', 'Pág.'],
        ['1', '¿Qué es JARAPP?', '3'],
        ['2', 'Acceso, Instalación en iPhone y Roles', '4'],
        ['3', 'Navegación — Los 14 módulos', '5'],
        ['4', 'Dashboard 360°', '6'],
        ['5', 'Cotizador de precios', '7'],
        ['6', 'Viaje EEUU — Gastos y distribución', '8'],
        ['7', 'JaraBot — Asistente de inteligencia artificial', '9'],
        ['8', 'Alertas automáticas', '10'],
        ['9', 'Glosario de términos', '11'],
        ['10', 'Flujos operativos', '12'],
        ['11', 'Preguntas frecuentes (FAQ)', '13'],
    ]
    story.append(ctable(toc_data, [1*cm, DOC_W - 2.5*cm, 1.5*cm]))
    story.append(PageBreak())

    # ── 1. ¿Qué es JARAPP? ────────────────────────────────────────────────────
    story += section_hdr('1. ¿Qué es JARAPP?', st, accent)
    story.append(Paragraph(
        'JARAPP es el sistema administrativo interno de Importaciones Jarapo. '
        'Centraliza todas las operaciones del negocio — ventas, inventario, compras en USA, '
        'logística y finanzas — en una sola aplicación web instalable en cualquier dispositivo.',
        st['normal']))
    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph('Beneficios principales:', st['h2']))
    beneficios = [
        'Gestión de ventas y cotizaciones en tiempo real con TRM automática',
        'Control de inventario con alertas automáticas de stock en cero',
        'Seguimiento de compras en USA fase por fase hasta la entrega',
        'Módulo de Viaje EEUU con distribución de gastos entre productos',
        'TRM actualizada automáticamente cada día desde open.er-api.com',
        'JaraBot — asistente IA para consultas del negocio con datos reales',
        'PWA instalable en iPhone y iPad desde Safari sin pasar por el App Store',
        'Control de acceso granular por roles (6 perfiles configurables)',
        'Dashboard 360° con 16 reportes, KPIs financieros y panel de alertas',
    ]
    story += bullets(beneficios, st)
    story.append(Spacer(1, 0.4 * cm))
    story.append(info_box(
        'JARAPP funciona en cualquier navegador moderno (Chrome, Safari, Firefox, Edge) '
        'y se puede instalar como aplicación nativa en iPhone, iPad y Android.',
        bg=SUCC_BG, border=SUCCESS, st=st))
    story.append(PageBreak())

    # ── 2. Acceso e instalación ────────────────────────────────────────────────
    story += section_hdr('2. Acceso, Instalación en iPhone y Roles', st, accent)
    story.append(Paragraph('Instalación como PWA en iPhone / iPad:', st['h2']))
    pasos_ios = [
        'Abrir Safari en el iPhone o iPad (no funciona con Chrome en iOS)',
        'Ir a la URL: https://jarapp.netlify.app',
        'Tocar el botón Compartir ⬆️ en la barra inferior del navegador',
        'Desplazarse y seleccionar "Añadir a pantalla de inicio"',
        'Confirmar el nombre "JARAPP" y tocar "Añadir"',
        'El ícono rojo de JARAPP aparecerá en tu pantalla de inicio',
    ]
    for i, paso in enumerate(pasos_ios, 1):
        story.append(Paragraph(f'{i}.  {paso}', st['bullet']))
    story.append(Spacer(1, 0.3 * cm))
    story.append(info_box(
        'JARAPP funciona sin conexión a internet gracias al Service Worker offline. '
        'Los datos consultados previamente se muestran desde caché. '
        'Los cambios se sincronizan automáticamente al recuperar la conexión.',
        bg=SUCC_BG, border=SUCCESS, st=st))
    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph('Roles y permisos de acceso:', st['h2']))
    roles_data = [
        ['Rol', 'Acceso principal'],
        ['Admin',     'Acceso total — todos los módulos + Admin y Configuración'],
        ['Gerente',   'Todos los módulos operativos incluyendo Viaje EEUU'],
        ['Ventas',    'Dashboard, Clientes, Inventario (solo ver), Ventas, Cotizador'],
        ['Logística', 'Dashboard, Inventario, Logística, Compras USA, Calculadora'],
        ['Finanzas',  'Dashboard, Ventas (solo ver), Finanzas, Calculadora'],
        ['Viewer',    'Solo Dashboard en modo lectura'],
    ]
    story.append(ctable(roles_data, [3 * cm, DOC_W - 3 * cm]))
    story.append(PageBreak())

    # ── 3. Navegación ─────────────────────────────────────────────────────────
    story += section_hdr('3. Navegación — Los 14 módulos', st, accent)
    story.append(Paragraph(
        'El sidebar izquierdo organiza los módulos en tres grupos: Operaciones, Gestión y Sistema. '
        'En móvil, una barra inferior reemplaza el sidebar.',
        st['normal']))
    story.append(Spacer(1, 0.3 * cm))
    nav_data = [
        ['Grupo', 'Módulo', 'Descripción'],
        ['Operaciones', 'Dashboard',     'Centro de análisis 360° con KPIs, alertas y 16 reportes'],
        ['Operaciones', 'Inventario',    'Catálogo de productos con stock, precios y fotos'],
        ['Operaciones', 'Ventas',        'Registro de ventas activas, abonos y saldos pendientes'],
        ['Operaciones', 'Cotizador',     'Calculadora de precios con TRM en vivo y exportación PDF'],
        ['Operaciones', 'Compras USA',   'Órdenes de compra en Estados Unidos con estado y tracking'],
        ['Operaciones', 'Seguimientos',  'Seguimiento fase por fase de envíos desde USA hasta entrega'],
        ['Operaciones', 'Viaje EEUU',    'Gestión completa de gastos de viaje y distribución por producto'],
        ['Gestión',     'Clientes',      'Base de datos de clientes con historial de compras y cartera'],
        ['Gestión',     'Finanzas',      'Gastos operativos, egresos por categoría y balance'],
        ['Gestión',     'Calculadora',   'Calculadora de precios con desglose completo de costos'],
        ['Sistema',     'Parámetros',    'Metas de ventas, días de alerta, TRM manual y configuraciones'],
        ['Sistema',     'Admin',         'Gestión de usuarios y asignación de roles (solo Admin)'],
        ['Sistema',     'Configuración', 'URL Supabase, logo de empresa y ajustes generales'],
        ['Widget',      'JaraBot',       'Chat IA disponible en cualquier módulo (Admin y Gerente)'],
    ]
    story.append(ctable(nav_data, [2.8*cm, 3.5*cm, DOC_W - 6.3*cm]))
    story.append(PageBreak())

    # ── 4. Dashboard ──────────────────────────────────────────────────────────
    story += section_hdr('4. Dashboard 360°', st, accent)
    story.append(Paragraph(
        'El Dashboard es la pantalla principal de JARAPP. Carga en paralelo todos los datos '
        'del negocio y los presenta en 5 secciones principales.',
        st['normal']))
    story.append(Spacer(1, 0.3 * cm))
    dash_items = [
        [Paragraph('Banner Viaje Activo', st['td_bold']),
         Paragraph('Aparece cuando hay un viaje a EEUU en curso. Muestra nombre, destino, '
                   'días activos y total de gastos. Clic para ir al módulo Viaje EEUU.', st['td'])],
        [Paragraph('Panel de Alertas', st['td_bold']),
         Paragraph('Alertas automáticas: cartera vencida, envíos sin actualizar, TRM fuera de '
                   'rango, stock en cero. Clic en cada alerta navega al registro específico.', st['td'])],
        [Paragraph('KPIs Financieros', st['td_bold']),
         Paragraph('5 tarjetas: Facturación, Total Cobrado, Cartera, Egresos y Balance de Caja. '
                   'Clic en cada KPI abre el reporte relacionado.', st['td'])],
        [Paragraph('Estado de Módulos', st['td_bold']),
         Paragraph('6 tarjetas resumen de Clientes, Ventas, Inventario, Compras, '
                   'Seguimientos y Finanzas con conteos y totales actualizados.', st['td'])],
        [Paragraph('Explorador de Reportes', st['td_bold']),
         Paragraph('16 reportes en 5 categorías: Finanzas, Ventas, Logística, Clientes y '
                   'Operaciones. Cada reporte incluye tabla interactiva y exportación Excel.', st['td'])],
    ]
    t = Table(dash_items, colWidths=[4 * cm, DOC_W - 4 * cm])
    t.setStyle(TableStyle([
        ('FONTNAME',   (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE',   (0, 0), (-1, -1), 8),
        ('VALIGN',     (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.white, ROW_ALT]),
        ('GRID',       (0, 0), (-1, -1), 0.4, BORDER),
        ('LEFTPADDING',  (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING',   (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING',(0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(PageBreak())

    # ── 5. Cotizador ──────────────────────────────────────────────────────────
    story += section_hdr('5. Cotizador de precios', st, accent)
    story.append(Paragraph(
        'El Cotizador calcula automáticamente el precio de venta en COP a partir del precio en '
        'USD de la tienda, aplicando impuestos, flete, TRM y margen de ganancia.',
        st['normal']))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph('Fórmula de cálculo (10 pasos):', st['h2']))
    formula_data = [
        ['Paso', 'Operación', 'Ejemplo (Calzado)'],
        ['1', 'Precio tienda − Descuento',               '$150.00 USD'],
        ['2', '× (1 + Tax USA 7%)',                      '$160.50 USD'],
        ['3', '× TRM del día',                           '$573,909 COP'],
        ['4', '+ Comisión pasarela 3%',                  '+$17,217 COP'],
        ['5', '+ Flete (libras × $3 USD × TRM)',         '+$42,924 COP  (4 lbs)'],
        ['6', '+ Costo distribución viaje (si aplica)',  '+$28,500 COP'],
        ['7', '+ Ganancia fija por categoría',           '+$100,000 COP'],
        ['8', 'Redondear al siguiente $1,000',           '$763,000 COP'],
        ['9', '+ Domicilio si total < $200,000',         '+$20,000 COP'],
        ['10', 'TOTAL PRECIO DE VENTA SUGERIDO',         '$763,000 COP'],
    ]
    t = ctable(formula_data, [1*cm, DOC_W - 4.5*cm, 3.5*cm])
    story.append(t)
    story.append(Spacer(1, 0.3 * cm))
    story.append(info_box(
        'El Cotizador genera dos PDFs automáticamente: uno para el cliente (sin desglose de '
        'costos internos) y uno interno con todos los componentes del precio. '
        'El mensaje de WhatsApp se copia al portapapeles con un solo clic.',
        bg=INFO_BG, border=INFO, st=st))
    story.append(PageBreak())

    # ── 6. Viaje EEUU ─────────────────────────────────────────────────────────
    story += section_hdr('6. Viaje EEUU — Gastos y distribución', st, accent)
    story.append(Paragraph(
        'El módulo Viaje EEUU registra todos los gastos de un viaje a Estados Unidos y '
        'los distribuye automáticamente entre los productos comprados.',
        st['normal']))
    story.append(Spacer(1, 0.3 * cm))
    gastos_data = [
        ['Tipo de gasto', 'Categoría', 'Se distribuye entre productos'],
        ['Tiquetes aéreos',      'Negocio',   'Sí — por peso del producto'],
        ['Hotel',                'Negocio',   'Sí — proporcional al valor'],
        ['Flete bodega → Colombia', 'Negocio','Sí — por peso del producto'],
        ['Overweight / exceso',  'Negocio',   'Sí — por libras extra'],
        ['Vehículo y gasolina',  'Negocio',   'Sí — proporcional'],
        ['Telefonía roaming',    'Negocio',   'Sí — proporcional'],
        ['Cajas y empaque',      'Negocio',   'Sí — por unidad'],
        ['Compras en outlets',   'Negocio',   'Sí — producto específico'],
        ['Otros gastos negocio', 'Negocio',   'Sí — proporcional'],
        ['Alimentación',         'Personal',  'No — gasto personal'],
        ['Actividades/turismo',  'Personal',  'No — gasto personal'],
        ['Souvenirs/regalos',    'Personal',  'No — gasto personal'],
    ]
    story.append(ctable(gastos_data, [5*cm, 3*cm, DOC_W - 8*cm]))
    story.append(Spacer(1, 0.3 * cm))
    story.append(info_box(
        'Solo los gastos de NEGOCIO se distribuyen entre los productos del viaje. '
        'Los gastos personales (alimentación, turismo, souvenirs) no afectan el costo '
        'de los productos importados y se registran por separado para control de gastos.',
        bg=WARN_BG, border=WARNING, st=st))
    story.append(PageBreak())

    # ── 7. JaraBot ────────────────────────────────────────────────────────────
    story += section_hdr('7. JaraBot — Asistente de inteligencia artificial', st, accent)
    story.append(Paragraph(
        'JaraBot es el asistente IA integrado de JARAPP. Responde preguntas sobre el negocio '
        'usando datos reales en tiempo real. Está disponible en todos los módulos a través '
        'del ícono de chat flotante.',
        st['normal']))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph('Preguntas de ejemplo que JaraBot puede responder:', st['h2']))
    preguntas = [
        '"¿Cuánto vendimos esta semana en total?"',
        '"¿Qué clientes tienen saldo pendiente mayor a 30 días?"',
        '"¿Qué productos están sin stock actualmente?"',
        '"¿Cómo va el viaje activo, cuántos días lleva y cuánto se ha gastado?"',
        '"¿Cuánto es la TRM de hoy y cómo está respecto a ayer?"',
        '"¿Cuáles son las 5 marcas más vendidas del mes?"',
        '"¿Cuántos anticipos hay pendientes de cobro?"',
        '"¿Qué seguimientos llevan más de 7 días sin actualizar?"',
        '"¿Cuál es el balance de caja esta semana?"',
        '"¿Qué productos tienen margen de ganancia menor al 20%?"',
    ]
    story += bullets(preguntas, st)
    story.append(Spacer(1, 0.3 * cm))
    story.append(info_box(
        'JaraBot está disponible solo para Admin y Gerente. '
        'Usa inteligencia artificial (Groq · llama-3.3-70b-versatile) con acceso a datos '
        'reales del negocio actualizados en tiempo real. No almacena el historial de conversación '
        'entre sesiones.',
        bg=INFO_BG, border=INFO, st=st))
    story.append(PageBreak())

    # ── 8. Alertas automáticas ────────────────────────────────────────────────
    story += section_hdr('8. Alertas automáticas', st, accent)
    story.append(Paragraph(
        'JARAPP genera alertas automáticas cada 30 minutos para mantener el control '
        'del negocio. Las alertas aparecen en el Dashboard y en el ícono de campana del sidebar.',
        st['normal']))
    story.append(Spacer(1, 0.3 * cm))
    alertas_data = [
        ['Tipo de alerta', 'Condición', 'Nivel', 'Acción recomendada'],
        ['Cartera vencida',
         'Ventas con saldo pendiente sin abonar > 3 días',
         'Danger',
         'Navegar a la venta y contactar al cliente por WhatsApp'],
        ['Seguimientos sin actualizar',
         'Envíos sin cambio de fase > N días (configurable en Parámetros)',
         'Warning',
         'Actualizar la fase del seguimiento con el estado actual'],
        ['TRM fuera de rango',
         'Variación de TRM mayor al umbral configurado (ej. > 2%)',
         'Info',
         'Revisar cotizaciones pendientes que puedan verse afectadas'],
        ['Stock en cero',
         'Productos activos con stock = 0 en Medellín',
         'Warning',
         'Actualizar inventario o marcar el producto como no disponible'],
        ['Fase 1 sin tracking',
         'Pedidos con más de 7 días en Fase 1 sin número de tracking',
         'Danger',
         'Contactar al proveedor o bodega USA para obtener el tracking'],
    ]
    story.append(ctable(alertas_data, [3.5*cm, 5*cm, 1.5*cm, DOC_W - 10*cm]))
    story.append(Spacer(1, 0.3 * cm))
    story.append(info_box(
        'Cada alerta en el panel del Dashboard es interactiva: al hacer clic navega '
        'directamente al registro específico (venta, seguimiento o producto) que generó la alerta.',
        bg=INFO_BG, border=INFO, st=st))
    story.append(PageBreak())

    # ── 9. Glosario ───────────────────────────────────────────────────────────
    story += section_hdr('9. Glosario de términos', st, accent)
    glosario = [
        ('TRM',         'Tasa Representativa del Mercado. Precio oficial del dólar en pesos colombianos. '
                        'Se actualiza automáticamente cada día desde open.er-api.com.'),
        ('Encargo',     'Venta de un producto que aún no está en stock. Se compra especialmente '
                        'para el cliente. Requiere anticipo mínimo del 35%.'),
        ('Stock Local', 'Producto disponible físicamente en Medellín para entrega inmediata sin '
                        'necesidad de importarlo.'),
        ('Cartera',     'Saldo total pendiente de cobro de todas las ventas activas que tienen '
                        'saldo sin pagar.'),
        ('Seguimiento', 'Registro del recorrido de un pedido desde la compra en USA hasta la '
                        'entrega final al cliente en Colombia.'),
        ('Viaje',       'Viaje de negocios a EEUU para comprar mercancía. Los gastos de negocio '
                        'se distribuyen automáticamente entre los productos del viaje.'),
        ('Fase',        'Etapa del proceso logístico: 1=Comprado, 2=Tránsito USA, 3=Bodega USA, '
                        '4=Tránsito Internacional, 5=En Colombia, 6=En Entrega, 7=Entregado.'),
        ('KPI',         'Key Performance Indicator. Indicador Clave de Desempeño que mide el '
                        'rendimiento del negocio en tiempo real.'),
        ('Abono',       'Pago parcial registrado contra una venta. Reduce el saldo pendiente. '
                        'Se puede registrar desde la vista detalle de la venta.'),
        ('Anticipo',    'Abono inicial para apartar un encargo. Generalmente el 35% del valor '
                        'total del producto.'),
        ('Dashboard',   'Pantalla principal con resumen visual de todas las métricas del negocio. '
                        'Carga en paralelo para máxima velocidad.'),
        ('JaraBot',     'Asistente de inteligencia artificial de JARAPP que conoce todos los '
                        'datos del negocio y responde preguntas en lenguaje natural.'),
        ('PWA',         'Progressive Web App. Tecnología que permite instalar JARAPP en iPhone '
                        'como si fuera una aplicación nativa, sin pasar por el App Store.'),
    ]
    for term, defn in glosario:
        story.append(KeepTogether([
            Paragraph(f'<b>{term}</b>', st['h3']),
            Paragraph(defn, st['normal']),
            Spacer(1, 0.2 * cm),
        ]))
    story.append(PageBreak())

    # ── 10. Flujos operativos ─────────────────────────────────────────────────
    story += section_hdr('10. Flujos operativos', st, accent)
    story.append(Paragraph('Flujo completo de una venta (8 pasos):', st['h2']))
    flujo_venta = [
        'Cliente contacta y describe el producto deseado',
        'Usar el Cotizador para calcular el precio con la TRM del día',
        'Enviar cotización por WhatsApp (botón automático en el Cotizador)',
        'Registrar el anticipo en Ventas — mínimo 35% para apartar el encargo',
        'Crear orden de Compra USA con producto, talla, color y proveedor',
        'Crear Seguimiento logístico y actualizar las fases conforme avanza',
        'Al llegar a Medellín (Fase 5), coordinar entrega y actualizar la fase',
        'Marcar como Entregado (Fase 7) y registrar el saldo final del cliente',
    ]
    for i, paso in enumerate(flujo_venta, 1):
        story.append(Paragraph(f'{i}.  {paso}', st['bullet']))
    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph('Las 7 fases del proceso logístico:', st['h2']))
    fases_data = [
        ['Fase', 'Nombre', 'Descripción', 'Responsable'],
        ['1', 'Comprado',             'Orden colocada, esperando número de tracking USA', 'Seller/Marketplace'],
        ['2', 'En Tránsito USA',      'Paquete en camino tienda → bodega en USA',         'Courier doméstico USA'],
        ['3', 'En Bodega USA',        'Listo en bodega intermedia, preparando envío',      'Bodega USA'],
        ['4', 'Tránsito Internacional','Vuelo o barco, en proceso de aduana',              'Operador logístico'],
        ['5', 'En Colombia',          'Llegó al país, en aduana o bodega nacional',        'Operador en Colombia'],
        ['6', 'En Entrega',           'Coordinando entrega final al cliente',              'Nosotros / mensajero'],
        ['7', 'Entregado',            'Proceso completado, cliente confirmó recibo',       'Cliente'],
    ]
    story.append(ctable(fases_data, [1.2*cm, 3.5*cm, DOC_W - 7.7*cm, 3*cm]))
    story.append(PageBreak())

    # ── 11. FAQ ───────────────────────────────────────────────────────────────
    story += section_hdr('11. Preguntas frecuentes (FAQ)', st, accent)
    faqs = [
        ('¿Puedo usar JARAPP desde el computador?',
         'Sí. JARAPP funciona en cualquier navegador moderno (Chrome, Firefox, Edge, Safari). '
         'Para la mejor experiencia en iPhone/iPad, instálala como PWA desde Safari.'),
        ('¿Qué pasa si pierdo la conexión a internet?',
         'JARAPP continúa funcionando con los datos almacenados en caché local. '
         'Los cambios realizados sin conexión se sincronizan automáticamente '
         'cuando vuelves a conectarte.'),
        ('¿Cómo actualizo el logo de la empresa?',
         'Ve a Configuración en el sidebar, sube el logo (PNG transparente recomendado). '
         'El logo aparecerá en el sidebar, en el Dashboard y en los PDFs del Cotizador.'),
        ('¿Puedo agregar más usuarios?',
         'Solo los usuarios con rol Admin pueden crear y gestionar usuarios desde el módulo '
         'Admin. Cada usuario recibe un correo de invitación de Supabase Auth.'),
        ('¿Cada cuánto se actualiza la TRM?',
         'La TRM se actualiza automáticamente una vez al día desde la API pública '
         'open.er-api.com. También se puede ajustar manualmente desde Parámetros '
         'o Configuración.'),
        ('¿Qué significa el badge "ACTIVO" en Viaje EEUU?',
         'Indica que hay un viaje en curso. El banner azul en el Dashboard también '
         'lo muestra con destino, días activos y total de gastos registrados. '
         'Al terminar el viaje, el badge desaparece automáticamente.'),
    ]
    for q, a in faqs:
        story.append(KeepTogether([
            Paragraph(f'P: {q}', st['qa_q']),
            Paragraph(f'R: {a}', st['qa_a']),
        ]))

    return story


# ═══════════════════════════════════════════════════════════════════════════════
# MANUAL TÉCNICO
# ═══════════════════════════════════════════════════════════════════════════════
def build_tecnico():
    accent = SECONDARY
    st = make_styles(accent)
    story = []

    # Portada — manejada por canvas
    story.append(PageBreak())

    # ── Índice ─────────────────────────────────────────────────────────────────
    story += section_hdr('Contenido del Manual', st, accent)
    toc_data = [
        ['#', 'Sección', 'Pág.'],
        ['1',  'Stack tecnológico', '3'],
        ['2',  'Variables de entorno', '4'],
        ['3',  'Arquitectura del proyecto', '5'],
        ['4',  'Schema de base de datos', '6'],
        ['5',  'Capa de servicios (src/services/)', '8'],
        ['6',  'RBAC — Control de acceso por roles (auth.js)', '9'],
        ['7',  'PWA — Service Worker e iOS', '10'],
        ['8',  'Funciones SQL personalizadas', '11'],
        ['9',  'Deploy CI/CD — Netlify', '12'],
        ['10', 'Consideraciones técnicas críticas', '13'],
    ]
    story.append(ctable(toc_data, [1*cm, DOC_W - 2.5*cm, 1.5*cm], hdr_bg=SECONDARY))
    story.append(PageBreak())

    # ── 1. Stack tecnológico ──────────────────────────────────────────────────
    story += section_hdr('1. Stack tecnológico', st, accent)
    stack_data = [
        ['Capa', 'Tecnología', 'Versión', 'Rol en el proyecto'],
        ['Frontend',    'Vanilla JavaScript (ES Modules)', '—',       'Lógica de la aplicación sin frameworks'],
        ['Build',       'Vite',                            '8.0.3',   'Bundler ultrarrápido con HMR y tree-shaking'],
        ['Base de datos','Supabase',                       '2.101.1', 'PostgreSQL + Auth + Storage + RLS + Realtime'],
        ['Gráficas',    'Chart.js',                        '4.5.1',   'Visualizaciones del Dashboard 360°'],
        ['Íconos',      'Lucide',                          '1.7.0',   'Sistema de íconos SVG consistente'],
        ['PDF',         'pdfmake',                         '0.3.9',   'Generación de PDFs para el Cotizador'],
        ['Excel',       'xlsx (SheetJS)',                  '0.18.5',  'Exportación de reportes a Excel'],
        ['HTTP',        'axios',                           '1.14.0',  'Peticiones HTTP auxiliares'],
        ['IA / LLM',    'Groq API',                        '—',       'JaraBot — llama-3.3-70b-versatile'],
        ['TRM',         'open.er-api.com',                 '—',       'Tipo de cambio USD/COP actualizado diario'],
        ['Hosting',     'Netlify',                         '—',       'Deploy automático desde GitHub (main)'],
        ['CSS',         'Custom Properties + tokens.css',  '—',       'Design tokens, temas claro/oscuro'],
        ['PWA',         'Service Worker + Web Manifest',   '—',       'Offline support + instalable en iOS/Android'],
    ]
    story.append(ctable(stack_data, [2.5*cm, 4.5*cm, 1.8*cm, DOC_W - 8.8*cm], hdr_bg=SECONDARY))
    story.append(PageBreak())

    # ── 2. Variables de entorno ───────────────────────────────────────────────
    story += section_hdr('2. Variables de entorno', st, accent)
    env_data = [
        ['Variable', 'Descripción', 'Ejemplo / Formato'],
        ['VITE_SUPABASE_URL', 'URL del proyecto Supabase',             'https://xxx.supabase.co'],
        ['VITE_SUPABASE_KEY', 'Anon Key (pública) de Supabase',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'],
        ['VITE_GROQ_API_KEY', 'API Key de Groq para JaraBot',          'gsk_...'],
    ]
    story.append(ctable(env_data, [4.5*cm, 5*cm, DOC_W - 9.5*cm], hdr_bg=SECONDARY))
    story.append(Spacer(1, 0.3 * cm))
    story.append(info_box(
        'Las variables se configuran en Netlify → Site Settings → Environment Variables para '
        'producción. Para desarrollo local, crear un archivo .env en la raíz del proyecto. '
        'NUNCA commitear el archivo .env al repositorio de GitHub. '
        'Las credenciales de Supabase también tienen un fallback hardcoded en src/db.js '
        'para garantizar funcionamiento en cualquier dispositivo sin configuración.',
        bg=ERR_BG, border=PRIMARY, st=st))
    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph('Cargar en desarrollo local:', st['h2']))
    story.append(Paragraph(
        'Crear archivo .env en la raíz del proyecto con las tres variables. '
        'Ejecutar npm run dev — Vite las inyecta automáticamente como import.meta.env.VITE_*',
        st['normal']))
    story.append(PageBreak())

    # ── 3. Arquitectura ───────────────────────────────────────────────────────
    story += section_hdr('3. Arquitectura del proyecto', st, accent)
    arch_data = [
        ['Ruta', 'Descripción'],
        ['index.html',                'Entry point HTML con meta tags PWA, iOS y theme-color'],
        ['src/main.js',               'Bootstrap, router SPA, NAV_GROUPS, badges, init PWA'],
        ['src/db.js',                 'Cliente Supabase — credenciales en cascada (env → hardcoded)'],
        ['src/auth.js',               'RBAC completo: ROLE_TEMPLATES, clase Auth, persistencia sesión'],
        ['src/utils.js',              'Helpers globales: formatCOP, showToast, downloadExcel, paginación'],
        ['src/style.css',             'Estilos globales + optimizaciones PWA iOS + safe areas'],
        ['src/tokens.css',            'Design tokens: colores, tipografía, radios, sombras'],
        ['src/views/dashboard.js',    'Dashboard 360° con viaje, alertas, KPIs y reportes'],
        ['src/views/sales.js',        'Ventas: CRUD, abonos, modal detalle, exportación Excel'],
        ['src/views/inventory.js',    'Inventario: catálogo, stock, precios, fotos Supabase Storage'],
        ['src/views/logistics.js',    'Seguimientos: fases logísticas 1-7, historial, alertas'],
        ['src/views/purchases.js',    'Compras USA: órdenes, estados, vinculación con seguimientos'],
        ['src/views/viaje.js',        'Viaje EEUU: gastos, distribución, balance personal/negocio'],
        ['src/views/cotizador.js',    'Cotizador con TRM en vivo, PDF cliente y PDF interno'],
        ['src/views/clients.js',      'Clientes: CRUD, historial de compras, cartera pendiente'],
        ['src/views/finance.js',      'Finanzas: egresos por categoría, balance de caja'],
        ['src/views/calculadora.js',  'Calculadora de precios con desglose completo'],
        ['src/views/params.js',       'Parámetros configurables: metas, días alerta, TRM manual'],
        ['src/views/admin.js',        'Admin: gestión de usuarios y roles (solo Admin)'],
        ['src/views/settings.js',     'Configuración: URL Supabase, logo empresa, ajustes'],
        ['src/services/trm.js',       'TRM Service: obtener tipo de cambio con caché y fallback'],
        ['src/services/alertas.js',   'Alertas Service: 5 tipos de alertas con caché 30 min'],
        ['src/services/viajes.js',    'Viaje Service: getActivo(), CRUD de viajes y gastos'],
        ['src/services/config.js',    'Config Service: parámetros del sistema desde Supabase'],
        ['src/services/jarabot.js',   'JaraBot Service: construcción de contexto y llamada Groq API'],
        ['src/components/jarabot-widget.js', 'Widget de chat flotante con historial de sesión'],
        ['src/components/alertas-panel.js',  'Panel renderizador de alertas con links de navegación'],
        ['src/dashboard/',            '4 módulos lazy del Dashboard 360° (ventas, logística, finanzas, clientes)'],
        ['public/sw.js',              'Service Worker v2: caché offline, network-first/cache-first'],
        ['public/manifest.json',      'PWA manifest: íconos, colores, scope, orientación, lang'],
        ['public/icon-192.png',       'Ícono PWA 192×192 generado con scripts/generate-icons.cjs'],
        ['public/icon-512.png',       'Ícono PWA 512×512 generado con scripts/generate-icons.cjs'],
        ['scripts/generate-icons.cjs','Generador de íconos PNG puro Node.js (sin dependencias externas)'],
    ]
    story.append(ctable(arch_data, [6.5*cm, DOC_W - 6.5*cm], hdr_bg=SECONDARY))
    story.append(PageBreak())

    # ── 4. Schema BD ──────────────────────────────────────────────────────────
    story += section_hdr('4. Schema de base de datos (Supabase / PostgreSQL)', st, accent)
    story.append(Paragraph('Tablas principales:', st['h2']))
    tables_main = [
        [Paragraph('<b>Tabla</b>', st['td_bold']),
         Paragraph('<b>Columnas principales</b>', st['td_bold']),
         Paragraph('<b>Notas</b>', st['td_bold'])],
        [Paragraph('Ventas', st['td_bold']),
         Paragraph('id (uuid), fecha, cliente_id, productos (jsonb), total_cop, '
                   'saldo_pendiente, estado, tipo (encargo/local), '
                   'numero_factura, fecha_factura_usd, trm_cop, tracking', st['td']),
         Paragraph('Estado: activa / entregada / cancelada', st['td'])],
        [Paragraph('Clientes', st['td_bold']),
         Paragraph('id (uuid), nombre, telefono, ciudad, instagram, '
                   'email, notas, activo', st['td']),
         Paragraph('cliente_id en Ventas es FK a id', st['td'])],
        [Paragraph('Productos', st['td_bold']),
         Paragraph('id (uuid), nombre, marca, categoria, precio_usd, '
                   'precio_cop, stock_medellin, stock_usa, activo, '
                   'imagen_url, descripcion, peso_lb', st['td']),
         Paragraph('imagen_url → Supabase Storage bucket jarapo-images', st['td'])],
        [Paragraph('Logistica', st['td_bold']),
         Paragraph('id (texto), fase (1-7), tracking_usa, tracking_col, '
                   'fecha_compra, fecha_llegada_col, producto, compra_id, '
                   'notas, peso_lb, costo_usd, dias_alerta', st['td']),
         Paragraph('ID formato: {timestamp_ms}LOG', st['td'])],
        [Paragraph('Compras', st['td_bold']),
         Paragraph('id (uuid), fecha, proveedor, producto, cantidad, '
                   'precio_usd, total_usd, estado, tracking, notas, '
                   'logistica_id, viaje_id', st['td']),
         Paragraph('Vinculada con Logistica y viajes', st['td'])],
        [Paragraph('Gastos', st['td_bold']),
         Paragraph('id (uuid), fecha, categoria, descripcion, monto_cop, '
                   'monto_usd, trm, proveedor, comprobante_url', st['td']),
         Paragraph('Gastos operativos del negocio en Colombia', st['td'])],
        [Paragraph('Abonos', st['td_bold']),
         Paragraph('id (uuid), venta_id, fecha, monto_cop, metodo_pago, notas', st['td']),
         Paragraph('FK venta_id → Ventas.id', st['td'])],
    ]
    t = Table(tables_main, colWidths=[3*cm, 7.5*cm, DOC_W - 10.5*cm], repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1,  0), SECONDARY),
        ('TEXTCOLOR',     (0, 0), (-1,  0), colors.white),
        ('FONTNAME',      (0, 0), (-1,  0), 'Helvetica-Bold'),
        ('FONTSIZE',      (0, 0), (-1, -1), 7.5),
        ('ALIGN',         (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS',(0, 1), (-1, -1), [colors.white, ROW_ALT]),
        ('GRID',          (0, 0), (-1, -1), 0.4, BORDER),
        ('LEFTPADDING',   (0, 0), (-1, -1), 5),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 5),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph('Tablas del sistema:', st['h2']))
    sys_data = [
        ['Tabla (snake_case)', 'Descripción'],
        ['viajes',           'Viajes a EEUU con campos de gastos y distribución'],
        ['trm_historico',    'Historial de TRM diaria — fecha, valor, fuente'],
        ['user_profiles',    'Perfiles de usuario con rol, nombre, email, activo'],
        ['login_logs',       'Registro de inicios de sesión con IP, fecha, dispositivo'],
        ['params',           'Parámetros configurables del sistema (key-value)'],
    ]
    story.append(ctable(sys_data, [4.5*cm, DOC_W - 4.5*cm], hdr_bg=SECONDARY))
    story.append(Spacer(1, 0.3 * cm))
    story.append(info_box(
        'Convención de nombres: tablas de negocio en PascalCase (Ventas, Clientes, Productos, '
        'Logistica, Compras, Gastos, Abonos). Tablas del sistema en snake_case '
        '(viajes, trm_historico, user_profiles, login_logs).',
        bg=INFO_BG, border=INFO, st=st))
    story.append(PageBreak())

    # ── 5. Servicios ──────────────────────────────────────────────────────────
    story += section_hdr('5. Capa de servicios (src/services/)', st, accent)
    story.append(Paragraph(
        'Todos los servicios usan el patrón: '
        'import { db } from "../db.js"; const client = () => db.client;',
        st['code']))
    story.append(Spacer(1, 0.3 * cm))
    servicios = [
        ('TrmService (trm.js)',
         ['get() — TRM de hoy con caché 24h, fuente open.er-api.com',
          'getHistorico(dias) — últimos N días desde trm_historico',
          'guardar(valor, fuente) — persiste nueva TRM en Supabase']),
        ('AlertasService (alertas.js)',
         ['getAlertas(forceRefresh) — retorna todas las alertas activas (caché 30 min)',
          'invalidar() — limpia el caché para forzar recarga',
          'hayDanger() — true si hay alguna alerta nivel danger',
          'dangerCount() — cantidad de alertas danger activas']),
        ('ViajeService (viajes.js)',
         ['getActivo() — viaje con fecha_fin null y activo=true',
          'getAll() — todos los viajes ordenados por fecha_inicio DESC',
          'crear(data) — nuevo viaje',
          'actualizar(id, data) — actualizar campos de gastos o estado',
          'cerrar(id) — setea fecha_fin = today y activo = false']),
        ('ConfigService (config.js)',
         ['get(key) — obtener parámetro por clave desde params table',
          'set(key, value) — actualizar o insertar un parámetro',
          'getAll() — todos los parámetros del sistema',
          'getLogo() — URL del logo desde sessionStorage o Supabase Storage']),
        ('JaraBotService (jarabot.js)',
         ['buildContext(role) — consulta todos los datos del negocio en paralelo',
          'chat(message, role) — llama a Groq API con contexto real del negocio',
          'Modelo: llama-3.3-70b-versatile',
          'Endpoint: https://api.groq.com/openai/v1/chat/completions']),
    ]
    for nombre, metodos in servicios:
        story.append(KeepTogether([
            Paragraph(nombre, st['h3']),
            *bullets(metodos, st),
            Spacer(1, 0.2 * cm),
        ]))
    story.append(PageBreak())

    # ── 6. RBAC ───────────────────────────────────────────────────────────────
    story += section_hdr('6. RBAC — Control de acceso por roles (auth.js)', st, accent)
    story.append(Paragraph('Métodos principales de la clase Auth:', st['h2']))
    auth_data = [
        ['Método', 'Descripción'],
        ['signIn(email, pwd)',     'Login con Supabase Auth — devuelve sesión y perfil de usuario'],
        ['signOut()',              'Cierra sesión y limpia localStorage y sessionStorage'],
        ['getSession()',           'Retorna la sesión activa desde localStorage (sin llamada remota)'],
        ['getProfile()',           'Lee el perfil del usuario (rol, nombre) desde user_profiles'],
        ['can(module)',            'Verifica si el rol del usuario puede acceder al módulo'],
        ['isAdmin()',              'true si el rol es "admin"'],
        ['isGerente()',            'true si el rol es "admin" o "gerente"'],
    ]
    story.append(ctable(auth_data, [4.5*cm, DOC_W - 4.5*cm], hdr_bg=SECONDARY))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph('ROLE_TEMPLATES — módulos permitidos por rol:', st['h2']))
    rbac_data = [
        ['Módulo',      'Admin', 'Gerente', 'Ventas', 'Logística', 'Finanzas', 'Viewer'],
        ['dashboard',   '✓', '✓', '✓', '✓', '✓', '✓'],
        ['inventory',   '✓', '✓', '✓ (ver)', '✓', '—', '—'],
        ['sales',       '✓', '✓', '✓', '—', '✓ (ver)', '—'],
        ['cotizador',   '✓', '✓', '✓', '—', '—', '—'],
        ['purchases',   '✓', '✓', '—', '✓', '—', '—'],
        ['logistics',   '✓', '✓', '—', '✓', '—', '—'],
        ['viaje',       '✓', '✓', '—', '—', '—', '—'],
        ['clients',     '✓', '✓', '✓', '—', '—', '—'],
        ['finance',     '✓', '✓', '—', '—', '✓', '—'],
        ['calculadora', '✓', '✓', '—', '✓', '✓', '—'],
        ['params',      '✓', '—', '—', '—', '—', '—'],
        ['admin',       '✓', '—', '—', '—', '—', '—'],
        ['settings',    '✓', '—', '—', '—', '—', '—'],
    ]
    story.append(ctable(rbac_data,
                        [3.5*cm] + [(DOC_W - 3.5*cm) / 6] * 6,
                        hdr_bg=SECONDARY))
    story.append(PageBreak())

    # ── 7. PWA / Service Worker ───────────────────────────────────────────────
    story += section_hdr('7. PWA — Service Worker e iOS', st, accent)
    story.append(Paragraph('Estrategias de caché del Service Worker (public/sw.js):', st['h2']))
    sw_data = [
        ['Tipo de recurso', 'Estrategia', 'Cachés utilizado'],
        ['JS, CSS, imágenes, fuentes (origin)', 'Cache First → Network fallback', 'jarapp-static-v2'],
        ['Supabase API (*.supabase.co)',          'Network First → Cache fallback',  'jarapp-dynamic-v2'],
        ['HTML / navegación',                    'Network First → Cache fallback',  'jarapp-dynamic-v2'],
        ['APIs externas (Groq, TRM)',            'Network Only (no se cachea)',      '—'],
        ['Offline fallback de navegación',       'Retorna index.html cacheado',      'jarapp-static-v2'],
    ]
    story.append(ctable(sw_data, [4.5*cm, 5*cm, DOC_W - 9.5*cm], hdr_bg=SECONDARY))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph('Meta tags iOS en index.html:', st['h2']))
    ios_data = [
        ['Meta tag', 'Valor', 'Propósito'],
        ['apple-mobile-web-app-capable',          'yes',         'Modo standalone en iOS (elimina barra Safari)'],
        ['apple-mobile-web-app-status-bar-style', 'default',     'Barra de estado del sistema visible'],
        ['apple-mobile-web-app-title',            'JARAPP',      'Nombre de la app en pantalla de inicio iOS'],
        ['apple-touch-startup-image',             '/icon-512.png','Splash screen al abrir la app'],
        ['apple-touch-icon (180×180)',            '/icon-192.png','Ícono en pantalla de inicio iOS'],
        ['viewport viewport-fit=cover',           'cover',       'Contenido bajo notch / Dynamic Island'],
        ['theme-color light',                     '#E63946',     'Color de barra del navegador en modo claro'],
        ['theme-color dark',                      '#1D3557',     'Color de barra del navegador en modo oscuro'],
    ]
    story.append(ctable(ios_data, [5*cm, 3*cm, DOC_W - 8*cm], hdr_bg=SECONDARY))
    story.append(Spacer(1, 0.3 * cm))
    story.append(info_box(
        'El SW maneja mensajes CLEAR_CACHE (limpia todos los cachés) y SKIP_WAITING '
        '(activa el nuevo SW inmediatamente). El indicador offline usa window.addEventListener '
        '("offline"/"online") y muestra un banner en la parte inferior con safe-area-inset-bottom.',
        bg=INFO_BG, border=INFO, st=st))
    story.append(PageBreak())

    # ── 8. Funciones SQL ──────────────────────────────────────────────────────
    story += section_hdr('8. Funciones SQL personalizadas', st, accent)
    story.append(Paragraph('Funciones PL/pgSQL en Supabase:', st['h2']))
    sql_fns = [
        ['Función', 'Parámetros', 'Retorna', 'Uso'],
        ['get_ventas_resumen()',
         'p_desde date, p_hasta date',
         'TABLE(total, cobrado, cartera, count)',
         'KPIs financieros del Dashboard'],
        ['get_logistica_fases()',
         'p_activas boolean',
         'TABLE(fase, count, dias_promedio)',
         'Estado del pipeline logístico'],
    ]
    story.append(ctable(sql_fns, [3.5*cm, 4*cm, 3.5*cm, DOC_W - 11*cm], hdr_bg=SECONDARY))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph('Índices para optimización de consultas:', st['h2']))
    idx_data = [
        ['Índice', 'Tabla', 'Columnas', 'Beneficio'],
        ['idx_ventas_estado',      'Ventas',    'estado, fecha',              'Filtrar ventas activas por fecha'],
        ['idx_logistica_fase',     'Logistica', 'fase, id',                   'Ordenar seguimientos por fase y tiempo'],
        ['idx_abonos_venta',       'Abonos',    'venta_id, fecha',            'Calcular saldo pendiente por venta'],
        ['idx_trm_fecha',          'trm_historico', 'fecha DESC',             'Obtener TRM más reciente eficientemente'],
        ['idx_user_profiles_role', 'user_profiles', 'role, activo',           'Filtrar usuarios por rol activo'],
    ]
    story.append(ctable(idx_data, [4.5*cm, 2.5*cm, 4*cm, DOC_W - 11*cm], hdr_bg=SECONDARY))
    story.append(Spacer(1, 0.3 * cm))
    story.append(info_box(
        'Patrón de consulta flat obligatorio: las consultas de Supabase NO usan joins anidados '
        '(las FKs no están declaradas en el schema). Siempre se hacen 3 consultas planas '
        'y se combinan manualmente con Map en JavaScript.',
        bg=ERR_BG, border=PRIMARY, st=st))
    story.append(PageBreak())

    # ── 9. Deploy CI/CD ───────────────────────────────────────────────────────
    story += section_hdr('9. Deploy CI/CD — Netlify', st, accent)
    story.append(Paragraph('Configuración de Netlify (.netlify/netlify.toml):', st['h2']))
    netlify_items = [
        'Build command: npm run build',
        'Publish directory: dist/',
        'Node version: 18 (configurado en variables de entorno de Netlify)',
        'SPA redirect: /* → /index.html con código 200 (reescritura, no redirección)',
        'Deploy automático: cada push a rama main dispara un build en Netlify',
        'Preview deploys: cada PR genera un URL de preview único',
    ]
    story += bullets(netlify_items, st)
    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph('Comandos de desarrollo:', st['h2']))
    cmds_data = [
        ['Comando', 'Descripción'],
        ['npm run dev',          'Servidor de desarrollo con HMR en http://localhost:5173'],
        ['npm run build',        'Build de producción — genera carpeta dist/'],
        ['npm run preview',      'Sirve el build de producción localmente para validar'],
        ['node scripts/generate-icons.cjs', 'Genera icon-192.png y icon-512.png en public/'],
        ['python scripts/generate_manuals.py', 'Genera los dos manuales PDF en docs/'],
    ]
    story.append(ctable(cmds_data, [6*cm, DOC_W - 6*cm], hdr_bg=SECONDARY))
    story.append(Spacer(1, 0.3 * cm))
    story.append(info_box(
        'Netlify usa caché de node_modules entre builds para reducir tiempos. '
        'Las variables de entorno VITE_* se inyectan durante el proceso de build de Vite — '
        'no en runtime del navegador. Cambiar una variable de entorno requiere un nuevo deploy.',
        bg=INFO_BG, border=INFO, st=st))
    story.append(PageBreak())

    # ── 10. Consideraciones técnicas ─────────────────────────────────────────
    story += section_hdr('10. Consideraciones técnicas críticas', st, accent)
    consideraciones = [
        ('Patrón de servicio DB obligatorio',
         'Siempre usar: import { db } from "../db.js"; const client = () => db.client; '
         'NUNCA importar supabase directamente. El módulo db.js implementa el fallback '
         'de credenciales (env → hardcoded) de forma centralizada.'),
        ('Consultas flat — no usar joins anidados',
         'Las foreign keys no están declaradas en el schema de Supabase. '
         'Las queries con relaciones anidadas devuelven error. '
         'Siempre hacer 3 queries planas y combinar con Map en JS.'),
        ('Formato de IDs de Logística',
         'El ID de Logistica tiene el formato {timestamp_ms}LOG — el prefijo numérico '
         'es el Unix timestamp en milisegundos. Esto permite ordenar cronológicamente '
         'con un simple ORDER BY id DESC sin necesidad de un campo fecha.'),
        ('CSS — variable correcta para texto tenue',
         'Usar --text-faint para texto tenue (gris suave). '
         'La variable --text-tertiary NO existe. Verificar siempre en tokens.css.'),
        ('package.json tiene "type": "module"',
         'Todos los archivos .js se tratan como ES Modules. '
         'Los scripts de Node.js que usen CommonJS (require/module.exports) '
         'DEBEN tener extensión .cjs para funcionar correctamente.'),
        ('State pattern de módulos',
         'Cada módulo de vista usa: let _rl = null; let _nav = null; + función _render(). '
         'Los event handlers se exponen como window._nombreFuncion() para '
         'ser accesibles desde atributos onclick en el HTML generado dinámicamente.'),
        ('Persistencia de badge Viaje Activo en sidebar',
         'El badge "ACTIVO" del sidebar se bake en el HTML durante renderLayout() '
         'leyendo sessionStorage.getItem("JARAPP_VIAJE_ACTIVO") de forma síncrona. '
         'Esto evita que desaparezca en cada re-render del nav. '
         'window._actualizarBadgeViaje() maneja las actualizaciones asíncronas.'),
    ]
    for titulo, detalle in consideraciones:
        story.append(KeepTogether([
            Paragraph(titulo, st['h3']),
            Paragraph(detalle, st['normal']),
            Spacer(1, 0.3 * cm),
        ]))

    return story


# ═══════════════════════════════════════════════════════════════════════════════
# GENERADOR PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════
def generate_manual(output_path, accent, cover_title1, cover_title2, cover_sub,
                    manual_name, story_fn):
    print(f'  Generando: {output_path}')
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN + 1.3 * cm,   # espacio para la barra del header
        bottomMargin=MARGIN,
        title=f'{cover_title1} — {cover_title2}',
        author='Importaciones Jarapo',
        subject=manual_name,
        creator='JARAPP generate_manuals.py v1.0',
    )

    story = story_fn()

    c_fn  = cover_fn(LOGO_PATH, accent, cover_title1, cover_title2, cover_sub)
    p_fn  = make_page_fn(LOGO_PATH, accent, manual_name)

    doc.build(story, onFirstPage=c_fn, onLaterPages=p_fn)
    size_kb = os.path.getsize(output_path) / 1024
    print(f'  [OK] {os.path.basename(output_path)} ({size_kb:.1f} KB)')
    return size_kb


def main():
    import sys
    if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    print('\n--- JARAPP Manual Generator ---')
    logo_ok = os.path.exists(LOGO_PATH)
    logo_size = round(os.path.getsize(LOGO_PATH) / 1024) if logo_ok else 0
    print(f'Logo: {"OK (" + str(logo_size) + " KB)" if logo_ok else "NO ENCONTRADO - se usara placeholder"}')
    print(f'Output: {OUTPUT_DIR}\n')

    # Manual Funcional (portada roja)
    size_f = generate_manual(
        output_path   = os.path.join(OUTPUT_DIR, 'JARAPP_Manual_Funcional.pdf'),
        accent        = PRIMARY,
        cover_title1  = 'JARAPP',
        cover_title2  = 'Manual de Usuario',
        cover_sub     = 'Guia completa para el equipo de Importaciones Jarapo - 2026',
        manual_name   = 'JARAPP - Manual Funcional v3.0',
        story_fn      = build_funcional,
    )

    # Manual Tecnico (portada azul)
    size_t = generate_manual(
        output_path   = os.path.join(OUTPUT_DIR, 'JARAPP_Manual_Tecnico.pdf'),
        accent        = SECONDARY,
        cover_title1  = 'JARAPP',
        cover_title2  = 'Manual Tecnico',
        cover_sub     = 'Arquitectura, servicios y guia de desarrollo - 2026',
        manual_name   = 'JARAPP - Manual Tecnico v3.0',
        story_fn      = build_tecnico,
    )

    print('\n--- Resumen ---')
    print(f'  JARAPP_Manual_Funcional.pdf  -> {size_f:.1f} KB')
    print(f'  JARAPP_Manual_Tecnico.pdf    -> {size_t:.1f} KB')
    print(f'  Carpeta: {OUTPUT_DIR}')
    print('-' * 30 + '\n')


if __name__ == '__main__':
    main()
