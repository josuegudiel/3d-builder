"""
Bubble Barn — generación del juego de planos.

    python3 plano.py            -> Bubble_Barn_Plano_Rectificado.pdf

Todas las cotas y ángulos salen de geometria.py / despiece.py.
"""
import math
from reportlab.lib.colors import black, white

from geometria import *          # noqa: F401,F403
import despiece as D
from dibujo import (Hoja, nuevo, escala, PAGINA, GRIS, GRIS_CLARO, ROJO, AZUL,
                    CREMA, VERDE, MARGEN)

SALIDA = 'Bubble_Barn_Plano_Rectificado.pdf'
W, H = PAGINA
AREA = (MARGEN + 12, MARGEN + 12, W - MARGEN - 12, H - MARGEN - 12)

PIEZAS = piezas_cercha()
TEJADO = perfil_tejado()


def yz(u, v):
    """Cercha (u,v) -> elevación frontal (Y, Z)."""
    return (u + ANCHO / 2, Z_ARRANQUE + v)


# ===========================================================================
#  Elementos comunes
# ===========================================================================
def terreno(v, x0, x1, z=0.0, grava=True):
    """Línea de terreno con rayado y, opcionalmente, el lecho de grava."""
    v.linea(x0, z, x1, z, 1.1)
    n = int((x1 - x0) / 3)
    for i in range(n + 1):
        x = x0 + i * 3
        v.linea(x, z, x - 2.2, z - 2.2, 0.35, GRIS)
    if grava:
        v.rect(x0 + 2, z - GRAVA, (x1 - x0) - 4, GRAVA, 0.5, GRIS, None, [1.2, 1.2])
        v.texto(x1 - 4, z - GRAVA / 2 - 1, f'GRAVA #57 {frac(GRAVA)}', 5.0,
                'Helvetica', GRIS, al='r')


def cubeta(v, xc, z_tablero, ancho_boca=11.9, alto=ALTO_CUBETA, dash=None):
    """Sección de una cubeta de 5 galones colgada del tablero."""
    r0, r1 = ancho_boca / 2, 10.33 / 2
    z0 = z_tablero - alto
    pts = [(xc - r0, z_tablero + 1.0), (xc - r1, z0), (xc + r1, z0),
           (xc + r0, z_tablero + 1.0)]
    v.poli(pts, False, 0.6, GRIS if dash else black, None, dash)
    v.linea(xc - r0 - 0.4, z_tablero + 1.0, xc + r0 + 0.4, z_tablero + 1.0,
            0.8, GRIS if dash else black, dash)


def cercha_alzado(v, u0=0.0, relleno=True, lw=0.75):
    """Dibuja la cercha completa en coordenadas (Y, Z)."""
    orden = ['cordon', 'cabio_bajo_i', 'cabio_alto_i', 'cabio_bajo_d',
             'cabio_alto_d', 'tirante', 'cola_i', 'cola_d']
    for k in orden:
        pts = [yz(u, val) for (u, val) in PIEZAS[k]]
        v.poli(pts, True, lw, black, white if relleno else None)


# ===========================================================================
#  A-0  PORTADA
# ===========================================================================
def _envolver(s, n):
    out, linea = [], ''
    for w in s.split():
        if len(linea) + len(w) + 1 > n:
            out.append(linea)
            linea = w
        else:
            linea = (linea + ' ' + w).strip()
    out.append(linea)
    return out


def hoja_A0(c):
    h = Hoja(c, 'A-0', 'PORTADA Y RESUMEN', 'NTS')
    x0, y0, x1, y1 = AREA
    h.texto(x0, y1 - 14, 'BUBBLE BARN — PLANO RECTIFICADO', 19, 'Helvetica-Bold')
    h.texto(x0, y1 - 28, 'Estación de burbujas para niños · 6\'-0" x 8\'-0" · '
            'apoyada sobre el terreno · 10 cubetas de 5 galones', 8.4,
            'Helvetica', GRIS)
    c.setStrokeColor(black)
    c.setLineWidth(1.2)
    c.line(x0, y1 - 36, x0 + 392, y1 - 36)

    # =========================  COLUMNA IZQUIERDA  =========================
    anc = [14, 76, 128, 174]
    h.texto(x0, 534, 'QUÉ CAMBIA RESPECTO AL PLANO ORIGINAL', 9.6,
            'Helvetica-Bold')
    cambios = [
        ('1', 'Altura', 'El techo arrancaba a 6\'-0 1/4": 5\'-0" libres + viga + '
         'muro de rodilla.', 'Arranca a 7\'-0" JUSTOS sobre el terreno. Se '
         'suprime el muro de rodilla.'),
        ('2', 'Cimentación', '4 pilares de hormigón de 12" Ø x 24" ENTERRADOS.',
         '2 patines 4x6 PT sobre grava, apoyados en el terreno, + 4 anclajes '
         'helicoidales.'),
        ('3', 'Geometría del techo', '68.8° y 23.9° (suman 92.7°): tres reglajes '
         'de sierra y las cotas no cerraban.',
         '67.5° y 22.5° (suman 90°): UN SOLO reglaje de 22.5° para toda la cercha.'),
        ('4', 'Cabios', 'Dos piezas distintas, 29 3/16" y 27 13/16", mal '
         'redondeadas.',
         f'UNA SOLA PIEZA de {frac(CUERDA)}, repetida {D.N_CABIOS} veces.'),
        ('5', 'Tirante de rodilla', '50 15/16", medido sobre la línea del tejado. '
         'Cortado así NO ENTRA.',
         f'{frac(TIRANTE_LARGA)} abajo y {frac(TIRANTE_CORTA)} arriba, contra la '
         f'cara interior de los cabios bajos.'),
        ('6', 'Ancho de la cercha', 'Las carreras sumaban 72 1/8": 1/8" más ancha '
         'que su propio cordón.', 'Cierra en 72.000000" exactos por construcción.'),
        ('7', 'Plataforma', 'A 18" y con los huecos a 11" del borde.',
         f'A {frac(Z_PLATAFORMA)} —para que la cubeta pase sobre el patín— y los '
         f'huecos a 14".'),
    ]
    yy = 521
    h.texto(x0 + anc[0], yy, 'TEMA', 6.4, 'Helvetica-Bold', GRIS)
    h.texto(x0 + anc[0] + anc[1], yy, 'PLANO ORIGINAL', 6.4, 'Helvetica-Bold', GRIS)
    h.texto(x0 + sum(anc[:3]), yy, 'PLANO NUEVO', 6.4, 'Helvetica-Bold', GRIS)
    yy -= 3
    c.setLineWidth(0.5)
    c.setStrokeColor(GRIS)
    c.line(x0, yy, x0 + sum(anc), yy)
    yy -= 9
    for num, tema, viejo, nvo in cambios:
        lv, ln = _envolver(viejo, 32), _envolver(nvo, 44)
        h.texto(x0 + 2, yy, num, 7.0, 'Helvetica-Bold', ROJO)
        h.texto(x0 + anc[0], yy, tema, 6.6, 'Helvetica-Bold')
        for k, l in enumerate(lv):
            h.texto(x0 + anc[0] + anc[1], yy - k * 7.2, l, 6.1, 'Helvetica', GRIS)
        for k, l in enumerate(ln):
            h.texto(x0 + sum(anc[:3]), yy - k * 7.2, l, 6.1,
                    'Helvetica-Bold' if k == 0 else 'Helvetica')
        yy -= max(len(lv), len(ln)) * 7.2 + 5
        c.setStrokeColor(GRIS_CLARO)
        c.setLineWidth(0.3)
        c.line(x0, yy + 3, x0 + sum(anc), yy + 3)

    # --- aviso -------------------------------------------------------------
    h.caja(x0, 268, sum(anc), 62, relleno=None, borde=ROJO, lw=1.2)
    h.texto(x0 + 8, 316, 'LOS ANCLAJES AL TERRENO NO SON OPCIONALES', 8.4,
            'Helvetica-Bold', ROJO)
    h.parrafo(x0 + 8, 305, _envolver(
        f'Al quitar los pilares enterrados se pierde el único anclaje que tenía la '
        f'caseta. Con {V_VIENTO:.0f} mph y los cuatro lados abiertos, el levante '
        f'sobre la cubierta ronda las {LEVANTE:.0f} lb frente a {RESISTE:.0f} lb de '
        f'peso propio movilizable: sin anclar, se la lleva el viento. Los '
        f'{ANCLAJES} anclajes de {ANCLAJE_CAPACIDAD:.0f} lb y los herrajes de la '
        f'hoja A-6 forman el camino continuo cumbrera > cabio > cordón > carrera > '
        f'poste > anclaje.', 100), 6.2, 8.0)

    # --- la cubierta -------------------------------------------------------
    h.caja(x0, 76, sum(anc), 182, relleno=CREMA, borde=ROJO, lw=1.2)
    h.texto(x0 + 10, 240, 'LA CUBIERTA, QUE ES LO QUE INTERESA', 10.4,
            'Helvetica-Bold', ROJO)
    grandes = [('67.5°', f'cabio bajo · pendiente {PEND_BAJA:.2f} en 12'),
               ('22.5°', f'cabio alto · pendiente {PEND_ALTA:.2f} en 12'),
               ('22.5°', 'inglete ÚNICO de sierra, bisel 0°, tabla plana'),
               (frac(CUERDA), f'los {D.N_CABIOS} cabios son LA MISMA pieza')]
    for k, (n, t) in enumerate(grandes):
        yy2 = 218 - k * 23
        h.texto(x0 + 12, yy2, n, 15.5, 'Helvetica-Bold')
        h.texto(x0 + 84, yy2 + 3.5, t, 6.6, 'Helvetica')
    h.parrafo(x0 + 12, 118, _envolver(
        'Los dos ángulos suman 90°, y ésa es exactamente la condición para que el '
        'asiento, la rodilla y la cumbrera se corten con el mismo reglaje. No es una '
        'elección estética: es el único par de pendientes que lo cumple. El original '
        'usaba 68.8° y 23.9° (suman 92.7°) y por eso pedía tres reglajes distintos, '
        'todos a menos de 3° entre sí: tres ocasiones de equivocarse.', 82),
        6.2, 8.0)

    # --- índice -------------------------------------------------------------
    hojas = [('A-0', 'Portada y resumen'), ('A-1', 'Alzado frontal'),
             ('A-2', 'Alzado lateral'), ('A-3', 'Planta de la plataforma'),
             ('A-4', 'Sección transversal'),
             ('A-5', 'PLANTILLA DE LA CERCHA'),
             ('A-6', 'Detalles constructivos'), ('A-7', 'Lista de corte'),
             ('A-8', 'Compra, secuencia y seguridad')]
    h.texto(x0, 58, 'ÍNDICE DE HOJAS', 7.6, 'Helvetica-Bold')
    for k, (n, t) in enumerate(hojas):
        col, fila = k // 3, k % 3
        xx, yy2 = x0 + col * 158, 46 - fila * 8.6
        h.texto(xx, yy2, n, 6.2, 'Helvetica-Bold', ROJO if n == 'A-5' else black)
        h.texto(xx + 20, yy2, t, 6.0,
                'Helvetica-Bold' if n == 'A-5' else 'Helvetica')

    # =========================  COLUMNA DERECHA  ===========================
    rx, rw = x0 + 408, 328
    v = h.vista(escala(0.55), rx + rw / 2, 436)
    for k, pts in PIEZAS.items():
        v.poli(pts, True, 0.7, black, white)
    v.arco(0, 0, R, 0, 180, 0.5, AZUL, [1.8, 1.8])
    v.arco(0, 0, R_INTERIOR, 0, 180, 0.5, AZUL, [1.4, 1.6])
    for (u, val) in P:
        v.circ(u, val, 1.1, 0.6, ROJO, ROJO)
    v.texto(0, 38.5, 'LA CERCHA, EN DOS ARCOS', 7.6, 'Helvetica-Bold', AZUL, al='c')
    v.texto(0, -14.5, f'R = {frac(R)} puntos de trabajo   ·   '
            f'r = {frac(R_INTERIOR, 32)} esquinas interiores', 6.2, 'Helvetica',
            AZUL, al='c')
    v.texto(0, -21.5, 'Con esos dos arcos queda replanteada la cercha entera.',
            6.0, 'Helvetica', GRIS, al='c')

    h.caja(rx, 204, rw, 144)
    h.texto(rx + 10, 335, 'NÚMEROS CLAVE', 8.6, 'Helvetica-Bold')
    filas = [('Huella', f'{pies(ANCHO)} x {pies(LARGO)}'),
             ('Arranque del techo sobre el terreno', pies(Z_ARRANQUE)),
             ('Cumbrera sobre el terreno', pies(Z_CUMBRERA)),
             ('Flecha del gambrel', pies(FLECHA)),
             ('Cabio bajo / cabio alto', '67.5° / 22.5°'),
             ('Reglaje de la ingletadora', '22.5°, bisel 0°, tabla plana'),
             (f'Cabio (los {D.N_CABIOS} iguales)', f'{frac(CUERDA)} punta larga'),
             ('Cordón inferior', f'{frac(CORDON)} a escuadra'),
             ('Cerchas', f'{N_CERCHAS} a {frac(SEP_CERCHAS)} O.C.'),
             ('Superficie de cubierta', f'{AREA_CUBIERTA:.0f} sq ft'),
             ('Cubetas de 5 galones', f'{N_CUBETAS}, huecos de {frac(DIAM_HUECO)} Ø'),
             ('Altura de la plataforma', pies(Z_PLATAFORMA)),
             ('Paso libre bajo la carrera', pies(Z_VIGA_INF))]
    for k, (kk, val) in enumerate(filas):
        yy2 = 322 - k * 8.6
        h.texto(rx + 10, yy2, kk, 6.3, 'Helvetica', GRIS)
        h.texto(rx + rw - 10, yy2, val, 6.3, 'Helvetica-Bold', al='r')

    h.caja(rx, 88, rw, 106, relleno=None)
    h.texto(rx + 10, 181, 'EL PLANO CIERRA — COMPROBADO POR CÁLCULO', 8.4,
            'Helvetica-Bold')
    h.parrafo(rx + 10, 169, [
        f'· 2 x (carrera baja + alta) = {2*(CARRERA_BAJA+CARRERA_ALTA):.6f}" '
        f'= la luz de {frac(ANCHO)}',
        f'· suma de flechas = '
        f'{CARRERA_BAJA*math.tan(ANG_BAJO)+CARRERA_ALTA*math.tan(ANG_ALTO):.6f}" '
        f'= la flecha de {frac(FLECHA)}',
        f'· los cuatro cabios miden {CUERDA:.6f}"; canto inferior '
        f'{CABIO_PUNTA_CORTA:.6f}"',
        f'· las tres esquinas interiores caen en el arco de {frac(R_INTERIOR, 32)}',
        f'· el tirante queda {frac(P_RODILLA_D[1]-TIRANTE_V_SUP, 32)} bajo el punto '
        f'de trabajo: NO choca con el cabio',
        '  alto — el del plano original sí chocaba',
        f'· arranque {pies(Z_ARRANQUE)} y cumbrera {pies(Z_CUMBRERA)}: las dos cotas '
        f'redondas se cumplen a la vez',
        f'· levante de viento {LEVANTE:.0f} lb frente a '
        f'{ANCLAJES*ANCLAJE_CAPACIDAD:.0f} lb de anclajes',
        '',
        '**28 comprobaciones automáticas, todas OK. Si alguna fallara,',
        '**este PDF no se habría generado.',
    ], 6.2, 7.9)
    c.showPage()


# ===========================================================================
#  A-1  ALZADO FRONTAL
# ===========================================================================
def hoja_A1(c):
    h = Hoja(c, 'A-1', 'ALZADO FRONTAL', '1/2" = 1\'-0"')
    x0, y0, x1, y1 = AREA
    s = escala(0.5)
    v = h.vista(s, x0 + 290, y0 + 120)

    terreno(v, -22, ANCHO + 22)
    # patines (testa)
    for (a, b) in PATIN_Y:
        v.rect(a, 0, b - a, Z_PATIN_SUP, 0.7, black, GRIS_CLARO)
    # postes
    for (a, b) in VIGA_Y:
        v.rect(a, Z_PATIN_SUP, POSTE, Z_VIGA_INF - Z_PATIN_SUP, 0.7, black, white)
    # jabalcones a 45
    for lado in (0, 1):
        a = VIGA_Y[lado][0] + (POSTE if lado == 0 else 0)
        sg = 1 if lado == 0 else -1
        p0 = (a, Z_VIGA_INF - JABALCON_CATETO)
        p1 = (a + sg * JABALCON_CATETO, Z_VIGA_INF)
        v.poli([p0, p1, (p1[0] - sg * 3.5, p1[1]),
                (p0[0], p0[1] - 3.5)], True, 0.6, black, white)
    # carrera de extremo
    v.rect(VIGA_Y[0][0], Z_VIGA_INF, VIGA_Y[1][1] - VIGA_Y[0][0],
           Z_VIGA_SUP - Z_VIGA_INF, 0.8, black, white)
    v.texto(ANCHO / 2, Z_VIGA_INF + 2.4, 'CARRERA 2x8 PT', 5.2, 'Helvetica',
            GRIS, al='c')
    # plataforma
    v.rect(0, Z_VIGUETA_INF, ANCHO, CANTO_VIGUETA, 0.7, black, white)
    v.rect(0, Z_VIGUETA_SUP, ANCHO, ESPESOR_TABLERO, 0.7, black, GRIS_CLARO)
    for (xc, _) in [(14.0, 0), (ANCHO - 14.0, 0)]:
        cubeta(v, xc, Z_PLATAFORMA, dash=[1.5, 1.5])
    # cerchas: la del hastial + el hastial cerrado
    hast = [yz(u, val) for (u, val) in
            [P_ALERO_I, P_RODILLA_I, P_CUMBRERA, P_RODILLA_D, P_ALERO_D]]
    v.poli(hast, True, 0.5, GRIS, CREMA)
    cercha_alzado(v)
    # línea de tejado con vuelo (por delante)
    v.poli([yz(u, val) for (u, val) in TEJADO], False, 1.5, black)
    # espesor de cubierta
    off = 0.5 + 0.25
    v.poli([yz(u, val + off / math.cos(ANG_ALTO) if abs(u) > 25 else val + off)
            for (u, val) in TEJADO], False, 0.4, GRIS)

    # -- cotas ---------------------------------------------------------------
    v.cota_h(0, ANCHO, Z_ARRANQUE + FLECHA, pies(ANCHO), off=52)
    v.cota_h(-ALERO_VUELO, ANCHO + ALERO_VUELO, Z_ARRANQUE + FLECHA,
             f'{pies(ANCHO + 2 * ALERO_VUELO)} CON ALEROS', off=68)
    v.cota_v(0, Z_ARRANQUE, -20, pies(Z_ARRANQUE), off=-14)
    v.cota_v(0, Z_CUMBRERA, -20, pies(Z_CUMBRERA), off=-36)
    v.cota_v(Z_ARRANQUE, Z_CUMBRERA, ANCHO + 20, pies(FLECHA), off=16)
    v.cota_v(0, Z_PLATAFORMA, ANCHO + 20, pies(Z_PLATAFORMA), off=16)
    v.cota_v(0, Z_VIGA_INF, ANCHO + 20, f'{pies(Z_VIGA_INF)} LIBRES', off=38)

    # -- notas ---------------------------------------------------------------
    v.nota(yz(14, 30.6), (ANCHO + 30, Z_CUMBRERA - 3), 'FALDÓN ALTO 22.5°',
           6.0, ROJO, font='Helvetica-Bold')
    v.nota((ANCHO / 2 - 4, Z_ARRANQUE + 22), (ANCHO + 30, Z_CUMBRERA - 15),
           'HASTIAL CERRADO · SIN HUECOS', 5.6)
    v.nota(yz(31, 12), (ANCHO + 30, Z_ARRANQUE + 12), 'FALDÓN BAJO 67.5°',
           6.0, ROJO, font='Helvetica-Bold')
    v.nota((ANCHO + 6, Z_ARRANQUE - 3), (ANCHO + 30, Z_ARRANQUE - 16),
           f'ALERO: vuela {frac(ALERO_VUELO)}, baja {frac(ALERO_CAIDA, 32)}', 5.6)
    v.nivel(ANCHO + 34, 0, '± 0\'-0"  TERRENO', 14)
    v.nivel(ANCHO + 34, Z_ARRANQUE, f'+ {pies(Z_ARRANQUE)}  ARRANQUE TECHO', 14)
    v.nivel(ANCHO + 34, Z_CUMBRERA, f'+ {pies(Z_CUMBRERA)}  CUMBRERA', 14)

    h.titulo_vista(x0 + 200, y0 + 30, 1, 'ALZADO FRONTAL', '1/2" = 1\'-0"')

    # -- panel de notas -------------------------------------------------------
    px = x0
    h.caja(px, y0 + 52, 180, 316, relleno=None)
    h.texto(px + 8, y0 + 354, 'NOTAS DEL ALZADO', 8.6, 'Helvetica-Bold')
    h.parrafo(px + 8, y0 + 340, [
        '**GEOMETRÍA DEL TECHO',
        f'· Luz {pies(ANCHO)}. Flecha {pies(FLECHA)} = luz/2.',
        f'· Los cinco puntos de trabajo caen en una',
        f'  semicircunferencia de radio {frac(R)}.',
        f'· Faldón bajo 67.5° ({PEND_BAJA:.2f} en 12).',
        f'· Faldón alto 22.5° ({PEND_ALTA:.2f} en 12).',
        f'· Los dos ángulos suman 90°: por eso hay',
        '  un solo reglaje de sierra. Ver hoja A-5.',
        '',
        '**CERRAMIENTO',
        '· Los cuatro lados van ABIERTOS bajo la',
        '  carrera. No hay muro de rodilla.',
        '· Los dos hastiales se cierran con tablero',
        '  recortado al perfil gambrel. Sin huecos.',
        '· Superficie útil para rótulo.',
        '',
        '**CUBIERTA',
        f'· {AREA_CUBIERTA:.0f} sq ft de faldón + alero.',
        '· 1/2" de contrachapado, fieltro 15 lb y',
        '  teja asfáltica arquitectónica.',
        '· AVISO: el faldón bajo está a 28.97 en 12,',
        '  por encima de 21 en 12. Las tejas exigen',
        '  6 clavos por pieza y sellado a mano de',
        '  las lengüetas (instrucción del fabricante',
        '  para pendiente fuerte).',
        '· Banda de arranque en el alero Y encima',
        '  de cada quiebro de rodilla.',
        '',
        '**GÁLIBOS',
        f'· Bajo la carrera: {pies(Z_VIGA_INF)}.',
        f'· Bajo la punta del alero: {pies(Z_ALERO_MIN)}.',
        f'· Los niños trabajan de pie EN EL SUELO,',
        f'  a la altura de la plataforma ({pies(Z_PLATAFORMA)}).',
    ], 6.2, 8.0)
    c.showPage()


# ===========================================================================
#  A-2  ALZADO LATERAL
# ===========================================================================
def hoja_A2(c):
    h = Hoja(c, 'A-2', 'ALZADO LATERAL', '1/2" = 1\'-0"')
    x0, y0, x1, y1 = AREA
    s = escala(0.5)
    v = h.vista(s, x0 + 232, y0 + 120)

    terreno(v, -26, LARGO + 26)
    v.rect(0, 0, LARGO, Z_PATIN_SUP, 0.7, black, GRIS_CLARO)
    v.texto(LARGO / 2, 1.1, f'PATÍN 4x6 PT — {frac(LARGO)}', 5.2, 'Helvetica',
            black, al='c')
    for (px, _) in [(POSTES_XY[0][0], 0), (POSTES_XY[1][0], 0)]:
        v.rect(px - POSTE / 2, Z_PATIN_SUP, POSTE, Z_VIGA_INF - Z_PATIN_SUP,
               0.7, black, white)
    # jabalcones en la dirección larga
    for lado in (0, 1):
        a = POSTES_XY[lado][0] + (POSTE / 2 if lado == 0 else -POSTE / 2)
        sg = 1 if lado == 0 else -1
        p0 = (a, Z_VIGA_INF - JABALCON_CATETO)
        p1 = (a + sg * JABALCON_CATETO, Z_VIGA_INF)
        v.poli([p0, p1, (p1[0] - sg * 3.5, p1[1]), (p0[0], p0[1] - 3.5)],
               True, 0.6, black, white)
    # taco central
    v.rect(LARGO / 2 - POSTE / 2, Z_PATIN_SUP, POSTE, Z_VIGUETA_INF - Z_PATIN_SUP,
           0.6, GRIS, white, [1.5, 1.5])
    # carrera y plataforma
    v.rect(0, Z_VIGA_INF, LARGO, Z_VIGA_SUP - Z_VIGA_INF, 0.8, black, white)
    v.texto(LARGO / 2, Z_VIGA_INF + 2.6, 'CARRERA DOBLE 2x8 PT + ALMA DE 1/2"',
            5.2, 'Helvetica', GRIS, al='c')
    v.rect(0, Z_VIGUETA_INF, LARGO, CANTO_VIGUETA, 0.7, black, white)
    v.rect(0, Z_VIGUETA_SUP, LARGO, ESPESOR_TABLERO, 0.7, black, GRIS_CLARO)
    for (xc, yc) in CENTROS_HUECOS:
        if abs(yc - 14.0) < 1e-6:
            cubeta(v, xc, Z_PLATAFORMA, dash=[1.5, 1.5])

    # cubierta vista de lado
    zr, zk, ze = Z_CUMBRERA, Z_ARRANQUE + P_RODILLA_D[1], Z_ARRANQUE
    zf0 = Z_ARRANQUE + ALERO_PUNTA[1]
    zf1 = Z_ALERO_MIN
    xa, xb = -VUELO_HASTIAL, LARGO + VUELO_HASTIAL
    for z in (zr, zk, ze):
        v.linea(xa, z, xb, z, 0.55, GRIS)
    v.rect(xa, zf1, xb - xa, zf0 - zf1, 0.9, black, CREMA)
    v.texto(LARGO / 2, zf1 + 1.2, 'FASCIA 1x4 SOBRE LAS COLAS DE ALERO', 5.2,
            'Helvetica', GRIS, al='c')
    # perfil del hastial en los dos extremos (rake)
    for xx, sg in ((xa, -1), (xb, 1)):
        prof = [(xx, Z_ARRANQUE + ALERO_PUNTA[1]), (xx, ze), (xx, zk), (xx, zr)]
        v.poli(prof, False, 1.4, black)
    v.linea(xa, zr, xb, zr, 1.5, black)
    v.linea(xa, zf0, xb, zf0, 1.0, black)
    # cerchas ocultas
    for pxx in POS_CERCHAS:
        v.linea(pxx + 0.75, ze, pxx + 0.75, zr, 0.35, GRIS, [1.4, 1.8])

    v.cota_h(0, LARGO, zr, pies(LARGO), off=44)
    v.cota_h(xa, xb, zr, f'{pies(LARGO + 2 * VUELO_HASTIAL)} CON VUELO EN HASTIAL',
             off=60)
    for a, b in zip(POS_CERCHAS[:-1], POS_CERCHAS[1:]):
        v.cota_h(a, b, zr, frac(b - a), off=28, size=5.2)
    v.cota_v(0, Z_ARRANQUE, xa - 6, pies(Z_ARRANQUE), off=-14)
    v.cota_v(0, Z_CUMBRERA, xa - 6, pies(Z_CUMBRERA), off=-36)
    v.cota_v(0, Z_PLATAFORMA, LARGO + 10, pies(Z_PLATAFORMA), off=16)
    v.cota_v(0, Z_VIGA_INF, LARGO + 10, f'{pies(Z_VIGA_INF)} LIBRES', off=38)

    v.nota((LARGO / 2, zk), (LARGO + 26, zk + 12),
           f'{N_CERCHAS} CERCHAS A {frac(SEP_CERCHAS)} O.C.', 5.8, ROJO,
           font='Helvetica-Bold')
    v.nota((xb - 3, (zr + zk) / 2), (LARGO + 26, zk - 2),
           f'VUELO EN HASTIAL {frac(VUELO_HASTIAL)}', 5.6)
    v.nota((JABALCON_CATETO, Z_VIGA_INF - 8), (LARGO + 26, Z_VIGA_INF - 16),
           'JABALCÓN 2x4 PT A 45°', 5.6)
    v.nota((LARGO / 2, Z_PLATAFORMA), (LARGO + 26, Z_PLATAFORMA + 8),
           'PLATAFORMA DE CUBETAS · HOJA A-3', 5.6)

    h.titulo_vista(x0 + 190, y0 + 30, 2, 'ALZADO LATERAL', '1/2" = 1\'-0"')

    px = x0
    h.caja(px, y0 + 52, 168, 316, relleno=None)
    h.texto(px + 8, y0 + 354, 'NOTAS DEL ALZADO', 8.6, 'Helvetica-Bold')
    h.parrafo(px + 8, y0 + 340, [
        '**ESTABILIDAD LATERAL',
        '· Los cuatro lados van abiertos: los únicos',
        '  planos de cortante son los 8 jabalcones',
        '  a 45° y el entablado de cubierta.',
        '· NO se puede suprimir ninguno de los 8.',
        f'· Jabalcón: catetos de {frac(JABALCON_CATETO)}, punta larga',
        f'  {frac(JABALCON_LARGA)}, punta corta {frac(JABALCON_CORTA)},',
        '  45° en los dos extremos.',
        '· 2 tornillos estructurales 1/4" x 4" por',
        '  extremo. Ver detalle 5 de la hoja A-6.',
        '',
        '**APOYO SOBRE EL TERRENO',
        f'· 2 patines 4x6 PT de {frac(LARGO)} bajo las líneas',
        '  de postes, sobre lecho de grava #57',
        f'  compactada de {frac(GRAVA)} con geotextil.',
        f'· El lecho sobresale {frac(4.0)} del perímetro',
        '  para drenaje.',
        '· Nivelar los patines con nivel de manguera',
        '  o láser: TODO lo demás depende de eso.',
        '· 4 anclajes helicoidales, uno por poste.',
        '',
        '**CERCHAS',
        f'· {N_CERCHAS} cerchas a {frac(SEP_CERCHAS)} O.C.: las de los extremos',
        '  a haces con la testa de la carrera.',
        '· 2 herrajes antihuracán por cercha.',
        f'· El vuelo de {frac(VUELO_HASTIAL)} en los hastiales se hace',
        '  con escalera de vuelo: 4 cabios más por',
        f'  hastial (idénticos) y travesaños de {frac(VUELO_HASTIAL)}.',
        '',
        '**TABLERO DE CUBIERTA',
        '· Bandas horizontales. El tablero NO puede',
        f'  doblarse en los quiebros: se corta en',
        f'  fajas de {frac(CUERDA)} y de 13".',
    ], 6.2, 8.0)
    c.showPage()


# ===========================================================================
#  A-3  PLANTA DE LA PLATAFORMA
# ===========================================================================
def hoja_A3(c):
    h = Hoja(c, 'A-3', 'PLANTA DE LA PLATAFORMA', '3/4" = 1\'-0"')
    x0, y0, x1, y1 = AREA
    v = h.vista(escala(0.75), 70, 196)

    for (a, b) in PATIN_Y:
        v.rect(0, a, LARGO, b - a, 0.5, GRIS, None, [2.2, 1.6])
    for (px, py) in POSTES_XY:
        v.rect(px - POSTE / 2, py - POSTE / 2, POSTE, POSTE, 0.5, GRIS,
               GRIS_CLARO, [1.4, 1.4])
    v.rect(0, 0, LARGO, RIM, 0.8, black, white)
    v.rect(0, ANCHO - RIM, LARGO, RIM, 0.8, black, white)
    v.rect(0, RIM, RIM, ANCHO - 2 * RIM, 0.8, black, white)
    v.rect(LARGO - RIM, RIM, RIM, ANCHO - 2 * RIM, 0.8, black, white)
    for vx in VIGUETAS_X:
        v.rect(vx - RIM / 2, RIM, RIM, ANCHO - 2 * RIM, 0.7, black, white)
    for (a, b, yt) in BLOQUEOS:
        arriba = any(abs(yt - (cy + DIAM_HUECO / 2)) < 1e-6
                     for _, cy in CENTROS_HUECOS)
        v.rect(a, yt if arriba else yt - RIM, b - a, RIM, 0.5, black, CREMA)
    v.rect(0, 0, LARGO, ANCHO, 1.2, black)
    for (cx, cy) in CENTROS_HUECOS:
        v.circ(cx, cy, DIAM_HUECO / 2, 0.9, black, white)
        v.circ(cx, cy, 6.0, 0.4, GRIS, None, [1.4, 1.4])
        v.linea(cx - 7.5, cy, cx + 7.5, cy, 0.3, GRIS, [3, 1.4, 1, 1.4])
        v.linea(cx, cy - 7.5, cx, cy + 7.5, 0.3, GRIS, [3, 1.4, 1, 1.4])

    zx0 = min(cx for cx, cy in CENTROS_HUECOS
              if abs(cy - ANCHO / 2) < 1e-6) + DIAM_HUECO / 2
    zx1, zy0 = LARGO - zx0, 14.0 + DIAM_HUECO / 2
    zy1 = ANCHO - zy0
    v.rect(zx0, zy0, zx1 - zx0, zy1 - zy0, 0.5, VERDE, None, [3, 2])
    v.texto((zx0 + zx1) / 2, (zy0 + zy1) / 2 + 4, 'ZONA LIBRE', 6.6,
            'Helvetica-Bold', VERDE, al='c')
    v.texto((zx0 + zx1) / 2, (zy0 + zy1) / 2 - 5,
            f'{pies(zx1 - zx0)} x {pies(zy1 - zy0)}', 6.2, 'Helvetica', VERDE,
            al='c')
    v.texto((zx0 + zx1) / 2, (zy0 + zy1) / 2 - 14, 'tapas y repuestos', 5.4,
            'Helvetica', VERDE, al='c')

    xs = sorted({cx for cx, cy in CENTROS_HUECOS if abs(cy - 14.0) < 1e-6})
    prev = 0.0
    for xx in xs:
        v.cota_h(prev, xx, ANCHO, frac(xx - prev), off=15, size=5.2)
        prev = xx
    v.cota_h(prev, LARGO, ANCHO, frac(LARGO - prev), off=15, size=5.2)
    v.cota_h(0, LARGO, ANCHO, pies(LARGO), off=33)
    prev = 0.0
    for vx in VIGUETAS_X:
        v.cota_h(prev, vx, 0, frac(vx - prev), off=-15, size=5.2)
        prev = vx
    v.cota_h(prev, LARGO, 0, frac(LARGO - prev), off=-15, size=5.2)
    prev = 0.0
    for yy in sorted({cy for cx, cy in CENTROS_HUECOS}):
        v.cota_v(prev, yy, LARGO, frac(yy - prev), off=15, size=5.2)
        prev = yy
    v.cota_v(prev, ANCHO, LARGO, frac(ANCHO - prev), off=15, size=5.2)
    v.cota_v(0, ANCHO, 0, pies(ANCHO), off=-15)

    v.nota((15.0, 14.0 - DIAM_HUECO / 2), (2, -26),
           f'HUECO {frac(DIAM_HUECO)} Ø — 10 ud.', 5.8, ROJO,
           font='Helvetica-Bold')
    v.nota((VIGUETAS_X[1], 12), (56, -20), 'VIGUETA 2x6 PT (3 ud.)', 5.6)
    v.nota((30, 19.5), (32, -26), 'BLOQUEO 2x6 — 2 por hueco, 20 en total', 5.6)

    h.titulo_vista(70, 156, 3, 'PLANTA DE LA PLATAFORMA', '3/4" = 1\'-0"')

    # --- detalle del hueco ---------------------------------------------------
    dx, dy, dw, dh = 552, 452, 212, 116
    h.caja(dx, dy, dw, dh, relleno=None, lw=0.6)
    h.titulo_vista(dx + 6, dy + dh - 16, 4, 'DETALLE DEL HUECO', '1 1/2" = 1\'-0"')
    h.recorte(dx + 3, dy + 3, dw - 6, dh - 26)
    dv = h.vista(escala(1.5), dx + dw / 2, dy + 74)
    dv.rect(-11, -0.75, 22, 0.75, 0.8, black, GRIS_CLARO)
    dv.poli([(-11.9 / 2, 1.0), (-11.3 / 2, 0.15), (-10.33 / 2, -8)], False, 0.7,
            black)
    dv.poli([(11.9 / 2, 1.0), (11.3 / 2, 0.15), (10.33 / 2, -8)], False, 0.7, black)
    dv.linea(-11.9 / 2, 1.0, 11.9 / 2, 1.0, 1.0)
    dv.rect(-11, -6.25, 3.0, 5.5, 0.6, black, white)
    dv.rect(8, -6.25, 3.0, 5.5, 0.6, black, white)
    dv.cota_h(-DIAM_HUECO / 2, DIAM_HUECO / 2, -0.75, frac(DIAM_HUECO) + ' Ø',
              off=-14, size=5.2)
    dv.cota_h(-11.9 / 2, 11.9 / 2, 1.0, 'BORDE 11 7/8" Ø', off=16, size=5.2)
    h.fin_recorte()
    h.texto(dx + 8, dy + 8, 'BLOQUEO 2x6 tangente · la cubeta cuelga del cono · '
            'canto sellado, radio 1/8"', 5.2, 'Helvetica', GRIS)

    # --- notas ---------------------------------------------------------------
    px, pw = 552, 212
    h.caja(px, 96, pw, 344, relleno=None)
    h.texto(px + 8, 426, 'NOTAS DE LA PLATAFORMA', 8.4, 'Helvetica-Bold')
    h.parrafo(px + 8, 412, [
        '**REPARTO DE LAS 10 CUBETAS',
        '· Anillo perimetral: 4 + 4 en los lados',
        '  largos y 1 en cada testero.',
        f'· Ningún hueco a más de {frac(14.0)} del borde:',
        '  el niño llega de pie desde el suelo.',
        f'· Entre huecos quedan {frac(11.0)} de tablero.',
        f'· Del hueco al larguero, {frac(5.0)}.',
        f'· Del hueco a la vigueta, {frac(4.75)}.',
        '',
        '**ARMADO',
        f'· Largueros 2x6 PT: {frac(LARGUERO_LARGO)} los largos,',
        f'  {frac(LARGUERO_CORTO)} los cortos, atornillados a la',
        '  CARA EXTERIOR de los postes (por eso',
        f'  el poste va retranqueado {frac(RETRANQUEO_POSTE)}).',
        f'· 3 viguetas 2x6 PT de {frac(VIGUETA_LARGO)} en',
        f'  X = {", ".join(frac(vx) for vx in VIGUETAS_X)}.',
        '· 2 bloqueos 2x6 tangentes a CADA hueco:',
        '  el borde de la cubeta apoya siempre',
        '  sobre madera. 20 en total.',
        f'· 2 tacos 4x4 PT de {frac(Z_VIGUETA_INF - Z_PATIN_SUP)} bajo el centro',
        '  de cada larguero largo, sobre el patín.',
        f'· Tablero 3/4" PT, cara superior a {pies(Z_PLATAFORMA)}.',
        '  Tornillos a 6" en bordes, 12" dentro.',
        '· Escotadura de 3 1/2" x 3 1/2" en las 4',
        '  esquinas, para pasar los postes.',
        '',
        '**CARGA Y USO',
        f'· 10 cubetas llenas = {PESO_CUBETAS:.0f} lb, todas sobre',
        '  el anillo perimetral. De ahí el bloqueo.',
        '· Solidariza la plataforma con postes y',
        f'  patines: esas {PESO_CUBETAS:.0f} lb son lastre gratis.',
        '· Pendiente 1/8" por pie hacia fuera.',
        '',
        '**ANTES DE TALADRAR LOS 10 HUECOS',
        f'· Haz UN hueco de prueba de {frac(DIAM_HUECO)} en un',
        '  recorte con la cubeta que vayas a usar.',
        '  Debe colgar del cono con el borde ~1"',
        '  sobre el tablero; si baja más de 2",',
        '  cierra el hueco a 10 3/4".',
        f'· Holgura al patín con la cubeta a tope: {frac(FONDO_CUBETA - Z_PATIN_SUP)}.',
    ], 5.9, 7.7)
    c.showPage()


# ===========================================================================
#  A-4  SECCIÓN TRANSVERSAL
# ===========================================================================
def hoja_A4(c):
    h = Hoja(c, 'A-4', 'SECCIÓN TRANSVERSAL', '1/2" = 1\'-0"')
    x0, y0, x1, y1 = AREA
    v = h.vista(escala(0.5), x0 + 322, y0 + 116)

    terreno(v, -34, ANCHO + 34)
    for (a, b) in PATIN_Y:
        pts = [(a, 0), (b, 0), (b, Z_PATIN_SUP), (a, Z_PATIN_SUP)]
        v.poli(pts, True, 0.8, black, white)
        v.rayado(pts, 2.6, 45)
    for (a, b) in VIGA_Y:
        v.rect(a, Z_PATIN_SUP, POSTE, Z_VIGA_INF - Z_PATIN_SUP, 0.8, black, white)
        pts = [(a, Z_VIGA_INF), (b, Z_VIGA_INF), (b, Z_VIGA_SUP), (a, Z_VIGA_SUP)]
        v.poli(pts, True, 0.9, black, white)
        v.rayado(pts, 2.6, 45)
    v.rect(0, Z_VIGUETA_INF, ANCHO, CANTO_VIGUETA, 0.8, black, white)
    v.rect(0, Z_VIGUETA_SUP, ANCHO, ESPESOR_TABLERO, 0.8, black, GRIS_CLARO)
    cubeta(v, 14.0, Z_PLATAFORMA)
    cubeta(v, ANCHO - 14.0, Z_PLATAFORMA)
    cercha_alzado(v)
    v.poli([yz(u, val) for (u, val) in TEJADO], False, 1.4, black)

    niveles = [(0, '± 0\'-0"', 'TERRENO ACABADO / GRAVA'),
               (Z_PATIN_SUP, f'+ {pies(Z_PATIN_SUP)}', 'CARA SUP. DEL PATÍN 4x6'),
               (FONDO_CUBETA, f'+ {pies(FONDO_CUBETA)}', 'FONDO DE CUBETA'),
               (Z_PLATAFORMA, f'+ {pies(Z_PLATAFORMA)}', 'TABLERO DE LA PLATAFORMA'),
               (Z_VIGA_INF, f'+ {pies(Z_VIGA_INF)}', 'CARA INF. DE LA CARRERA'),
               (Z_VIGA_SUP, f'+ {pies(Z_VIGA_SUP)}', 'CARA SUP. DE LA CARRERA'),
               (Z_ARRANQUE, f'+ {pies(Z_ARRANQUE)}', 'ARRANQUE DEL TECHO'),
               (Z_ARRANQUE + TIRANTE_V_INF, f'+ {pies(Z_ARRANQUE + TIRANTE_V_INF)}',
                'CANTO INF. DEL TIRANTE'),
               (Z_ARRANQUE + P_RODILLA_D[1], f'+ {pies(Z_ARRANQUE + P_RODILLA_D[1])}',
                'RODILLA'),
               (Z_CUMBRERA, f'+ {pies(Z_CUMBRERA)}', 'CUMBRERA')]
    for z, t, _ in niveles:
        if z in (Z_PATIN_SUP, FONDO_CUBETA, Z_VIGA_SUP):
            continue
        v.nivel(ANCHO + 16, z, t, 26)
    v.cota_v(0, Z_ARRANQUE, -ALERO_VUELO - 10, pies(Z_ARRANQUE), off=-30)
    v.cota_v(Z_ARRANQUE, Z_CUMBRERA, -ALERO_VUELO - 10, pies(FLECHA), off=-30)
    v.cota_v(0, Z_CUMBRERA, -ALERO_VUELO - 10, pies(Z_CUMBRERA), off=-54)
    v.cota_h(0, ANCHO, 0, pies(ANCHO), off=-30)

    h.titulo_vista(x0 + 200, y0 + 42, 5, 'SECCIÓN TRANSVERSAL', '1/2" = 1\'-0"')

    px = x0
    h.caja(px, y0 + 62, 214, 316, relleno=None)
    h.texto(px + 8, y0 + 364, 'CUADRO DE NIVELES', 8.6, 'Helvetica-Bold')
    yy = y0 + 350
    for z, t, d in reversed(niveles):
        h.texto(px + 8, yy, t, 6.6, 'Helvetica-Bold')
        h.texto(px + 52, yy, d, 6.0, 'Helvetica', GRIS)
        yy -= 9.2
    yy -= 6
    h.texto(px + 8, yy, 'POR QUÉ ESTOS NIVELES', 8.6, 'Helvetica-Bold')
    h.parrafo(px + 8, yy - 13, [
        f'· El cliente fija {pies(ARRANQUE_TECHO)} del terreno a DONDE EMPIEZA',
        '  el techo. Ese punto es el canto superior del cordón',
        '  inferior de la cercha, que es donde arrancan los cabios.',
        f'· El cordón (2x4 de canto, {frac(ANCHO_CABIO)}) va encima de la carrera:',
        f'  la cara superior de la carrera queda a {pies(Z_VIGA_SUP)}.',
        f'· Con la flecha de {pies(FLECHA)}, la cumbrera cae en {pies(Z_CUMBRERA)}',
        '  EXACTOS. Las dos cotas redondas se cumplen a la vez.',
        f'· La plataforma sube de 18" a {frac(Z_PLATAFORMA)}: apoyada sobre el',
        '  terreno, una cubeta colgada tocaría el patín. Con',
        f'  {frac(Z_PLATAFORMA)} quedan {frac(FONDO_CUBETA - Z_PATIN_SUP)} de holgura.',
        f'· Paso libre bajo la carrera {pies(Z_VIGA_INF)} y bajo la punta',
        f'  del alero {pies(Z_ALERO_MIN)}: un adulto pasa de pie por los',
        '  cuatro lados.',
    ], 6.1, 8.0)
    c.showPage()


# ===========================================================================
#  Tabla genérica
# ===========================================================================
def tabla(h, x, y, anchos, cabecera, filas, size=6.1, lead=9.2, cab_size=6.0,
          resaltar=(), color_res=ROJO):
    """Dibuja una tabla.  Devuelve la Y del borde inferior."""
    c = h.c
    total = sum(anchos)
    c.setStrokeColor(black)
    c.setLineWidth(0.8)
    c.line(x, y, x + total, y)
    cx = x
    for i, t in enumerate(cabecera):
        al = 'r' if t.startswith('>') else 'l'
        h.texto(cx + (anchos[i] - 3 if al == 'r' else 2), y - 8.6,
                t.lstrip('>'), cab_size, 'Helvetica-Bold', al=al)
        cx += anchos[i]
    y -= 11.6
    c.setLineWidth(0.6)
    c.line(x, y, x + total, y)
    for j, fila in enumerate(filas):
        y -= lead
        col = color_res if j in resaltar else black
        cx = x
        for i, t in enumerate(fila):
            al = 'r' if cabecera[i].startswith('>') else 'l'
            font = 'Helvetica-Bold' if (j in resaltar or i == 0) else 'Helvetica'
            h.texto(cx + (anchos[i] - 3 if al == 'r' else 2), y, str(t), size,
                    font, col, al=al)
            cx += anchos[i]
        c.setStrokeColor(GRIS_CLARO)
        c.setLineWidth(0.25)
        c.line(x, y - 3, x + total, y - 3)
    y -= 3
    c.setStrokeColor(black)
    c.setLineWidth(0.8)
    c.line(x, y, x + total, y)
    return y


# ===========================================================================
#  A-5  PLANTILLA DE LA CERCHA  —  LA HOJA IMPORTANTE
# ===========================================================================
def hoja_A5(c):
    h = Hoja(c, 'A-5', 'PLANTILLA DE LA CERCHA', '3/4" = 1\'-0"  (cuadros NTS)')
    x0, y0, x1, y1 = AREA
    v = h.vista(escala(0.75), 334, 392)

    # --- construcción geométrica -------------------------------------------
    v.arco(0, 0, R, 0, 180, 0.6, AZUL, [2.6, 2.2])
    v.arco(0, 0, R_INTERIOR, 0, 180, 0.45, AZUL, [1.4, 1.6])
    for a in (0, 45, 90, 135, 180):
        v.linea(0, 0, R * math.cos(math.radians(a)), R * math.sin(math.radians(a)),
                0.35, AZUL, [3, 1.5, 1, 1.5])
    for a0, a1 in ((0, 45), (45, 90), (90, 135), (135, 180)):
        rr = 9.0 if a0 in (0, 135) else 12.5
        v.angulo((0, 0), a0, a1, rr, '45°', 5.6, AZUL, rtxt=rr + 3.6)

    # --- piezas -------------------------------------------------------------
    for k in ('cordon', 'cabio_bajo_i', 'cabio_alto_i', 'cabio_bajo_d',
              'cabio_alto_d', 'tirante', 'cola_i', 'cola_d'):
        v.poli(PIEZAS[k], True, 1.0, black, white)
    v.rayado(PIEZAS['cordon'], 3.0, 45)
    for (u, val) in P:
        v.circ(u, val, 1.0, 0.7, ROJO, ROJO)
    for (u, val) in (ESQ_ASIENTO, ESQ_RODILLA, ESQ_CUMBRERA):
        for sg in (1, -1):
            v.circ(sg * u, val, 0.8, 0.6, AZUL, white)

    # --- ángulos ------------------------------------------------------------
    v.angulo(P_ALERO_D, 112.5, 180, 10, '67.5°', 8.4, ROJO, rtxt=14)
    v.angulo(P_ALERO_I, 0, 67.5, 10, '67.5°', 8.4, ROJO, rtxt=14)
    v.angulo(P_RODILLA_D, 157.5, 292.5, 7, '135°', 7.6, ROJO, rtxt=10.5)
    v.angulo(P_RODILLA_I, 247.5, 382.5, 7, '135°', 7.6, ROJO, rtxt=10.5)
    v.angulo(P_CUMBRERA, 202.5, 337.5, 5.2, '135°', 7.6, ROJO, rtxt=8.0)
    v.angulo(P_CUMBRERA, 180, 202.5, 14, '22.5°', 7.0, ROJO, rtxt=17.5)
    v.angulo(P_CUMBRERA, -22.5, 0, 14, '22.5°', 7.0, ROJO, rtxt=17.5)
    v.angulo(P_ALERO_D, -22.5, 0, 9, '22.5°', 7.0, ROJO, rtxt=12.0)
    v.linea(-19, FLECHA, 19, FLECHA, 0.35, GRIS, [3, 2])
    v.linea(R, 0, R + 13, 0, 0.35, GRIS, [3, 2])

    # --- cotas --------------------------------------------------------------
    v.cota_h(P_ALERO_D[0], P_RODILLA_D[0], FLECHA, frac(CARRERA_BAJA), off=14)
    v.cota_h(P_RODILLA_D[0], 0, FLECHA, frac(CARRERA_ALTA), off=14)
    v.cota_h(P_ALERO_I[0], P_RODILLA_I[0], FLECHA, frac(CARRERA_BAJA), off=14)
    v.cota_h(P_RODILLA_I[0], 0, FLECHA, frac(CARRERA_ALTA), off=14)
    v.cota_h(-R, R, FLECHA, f'{pies(ANCHO)}   CORDÓN INFERIOR A ESCUADRA', off=30)
    v.cota_v(0, P_RODILLA_D[1], -46, frac(CARRERA_ALTA), off=-14)
    v.cota_v(P_RODILLA_D[1], FLECHA, -46, frac(CARRERA_BAJA), off=-14)
    v.cota_v(0, FLECHA, -46, f'{pies(FLECHA)}  FLECHA', off=-32)
    v.cota_al(P_ALERO_D, P_RODILLA_D, frac(CUERDA), off=13, size=7.2, lado=-1)
    v.cota_al(P_RODILLA_D, P_CUMBRERA, frac(CUERDA), off=13, size=7.2, lado=-1)
    v.cota_al(ESQ_ASIENTO, ESQ_RODILLA, frac(CABIO_PUNTA_CORTA), off=-9,
              size=5.6, lado=-1)
    v.cota_h(-TIRANTE_CORTA / 2, TIRANTE_CORTA / 2, TIRANTE_V_SUP,
             frac(TIRANTE_CORTA) + '  canto sup.', off=9, size=5.8)
    v.cota_h(-TIRANTE_LARGA / 2, TIRANTE_LARGA / 2, TIRANTE_V_INF,
             frac(TIRANTE_LARGA) + '  canto inf.', off=-11, size=5.8)
    v.cota_h(P_ALERO_D[0], ALERO_PUNTA[0], ALERO_PUNTA[1] - 4.2, frac(ALERO_VUELO),
             off=-11, size=5.6)
    v.cota_v(ALERO_PUNTA[1], 0, ALERO_PUNTA[0] + 2.5, frac(ALERO_CAIDA, 32),
             off=12, size=5.6)

    # --- notas, todas hacia la derecha --------------------------------------
    notas = [
        ((R * math.cos(math.radians(26)), R * math.sin(math.radians(26))), 41,
         f'ARCO EXTERIOR  R = {frac(R)}', AZUL, 'Helvetica-Bold'),
        ((R_INTERIOR * math.cos(math.radians(16)),
          R_INTERIOR * math.sin(math.radians(16))), 35,
         f'ARCO INTERIOR  r = {frac(R_INTERIOR, 32)}', AZUL, 'Helvetica-Bold'),
        (P_RODILLA_D, 29, 'PUNTO DE TRABAJO (canto superior)', ROJO, 'Helvetica'),
        (ESQ_RODILLA, 23, 'ESQUINA INTERIOR DEL INGLETE', AZUL, 'Helvetica'),
        ((0, TIRANTE_V_SUP), 17, 'TIRANTE: topa en la cara interior de los '
         'cabios BAJOS', black, 'Helvetica'),
        (((ESQ_ASIENTO[0] + P_ALERO_D[0]) / 2, 0), 11,
         f'ASIENTO: cara de {frac(CARA_TOPE)} sobre el cordón', black, 'Helvetica'),
        (((ALERO_TALON[0] + ALERO_PUNTA[0]) / 2, -1.5), 5,
         'COLA DE ALERO: es la cartela del talón', black, 'Helvetica'),
    ]
    for pt, vv, txt, col, fnt in notas:
        v.nota(pt, (51, vv), txt, 5.9, col, font=fnt)

    h.titulo_vista(60, 336, 6, 'PLANTILLA DE LA CERCHA — TODOS LOS ÁNGULOS',
                   '3/4" = 1\'-0"')

    # =====================  banda inferior  ==================================
    # --- un solo reglaje -----------------------------------------------------
    h.caja(x0, 156, 176, 166, relleno=CREMA, borde=ROJO, lw=1.2)
    h.texto(x0 + 9, 306, 'UN SOLO REGLAJE', 11.5, 'Helvetica-Bold', ROJO)
    h.texto(x0 + 9, 293, 'DE SIERRA', 11.5, 'Helvetica-Bold', ROJO)
    h.texto(x0 + 9, 277, 'INGLETE  22.5°', 13, 'Helvetica-Bold')
    h.texto(x0 + 9, 263, 'BISEL  0°', 13, 'Helvetica-Bold')
    h.texto(x0 + 9, 252, 'tabla plana sobre la mesa', 6.2, 'Helvetica', GRIS)
    h.parrafo(x0 + 9, 240, [
        'Vale para los tres cortes de la cercha',
        'y también para la cola del alero:',
        '· asiento del cabio bajo',
        '· unión de rodilla (las 2 piezas)',
        '· cumbrera (las 2 piezas)',
        '· los 2 extremos del tirante',
        '· los 2 extremos de la cola de alero',
        f'Único corte a ESCUADRA: el cordón',
        f'inferior de {frac(CORDON)}.',
    ], 6.1, 8.1)
    h.parrafo(x0 + 9, 168, [
        f'tan 67.5° = 1+raíz2 = {math.tan(ANG_BAJO):.6f}',
        f'tan 22.5° = raíz2-1 = {math.tan(ANG_ALTO):.6f}',
    ], 5.9, 8.0)

    # --- por qué 22.5 --------------------------------------------------------
    h.caja(x0, 34, 176, 112, relleno=None)
    h.texto(x0 + 9, 132, 'POR QUÉ SALE 22.5° Y NO OTRO', 7.6, 'Helvetica-Bold')
    h.parrafo(x0 + 9, 120, [
        'Pedir el MISMO inglete en los tres',
        'cortes, con tB = cabio bajo y',
        'tA = cabio alto, da dos ecuaciones:',
        '',
        '   asiento    90 - tB  =  tA',
        '   rodilla   (tB - tA)/2 = tA',
        '',
        'De ahí tB + tA = 90 y tB = 3 tA,',
        'cuya única solución es 22.5° y 67.5°.',
        'No es una elección estética: es el',
        'único par que existe.',
    ], 6.1, 8.0)

    # --- retranqueo -----------------------------------------------------------
    h.caja(x0 + 188, 34, 192, 92, relleno=None)
    h.texto(x0 + 197, 116, 'RETRANQUEO DEL INGLETE', 7.6, 'Helvetica-Bold')
    dv = h.vista(escala(1.5), x0 + 219, 66)
    dv.poli([(0, 0), (16, 0), (16 - ANCHO_CABIO * math.tan(ANG_ALTO), ANCHO_CABIO),
             (0, ANCHO_CABIO)], True, 1.0, black, white)
    dv.cota_h(0, 16, ANCHO_CABIO, 'PUNTA LARGA', off=11, size=5.0)
    dv.cota_h(0, 16 - ANCHO_CABIO * math.tan(ANG_ALTO), 0, 'PUNTA CORTA',
              off=-10, size=5.0)
    dv.cota_v(0, ANCHO_CABIO, 0, frac(ANCHO_CABIO), off=-11, size=5.0)
    dv.angulo((16, 0), 112.5, 180, 2.6, '22.5°', 6.0, ROJO, rtxt=4.6)
    h.parrafo(x0 + 197, 46, [
        f'Retranqueo = {frac(ANCHO_CABIO)} x tan 22.5° = {frac(RETRANQUEO)} '
        f'({RETRANQUEO:.4f}") por corte.',
        f'Cara de corte = {frac(ANCHO_CABIO)} / cos 22.5° = {frac(CARA_TOPE)}.',
    ], 6.0, 8.0)

    # --- cuadro de cortes -----------------------------------------------------
    tx = x0 + 188
    h.texto(tx, 308, 'CUADRO DE CORTES DE LA CERCHA', 9.4, 'Helvetica-Bold')
    filas = [
        ('T1', 'Cabio', str(D.N_CABIOS), '22.5°', '0°', frac(CABIO_PUNTA_LARGA),
         frac(CABIO_PUNTA_CORTA), frac(CARA_TOPE),
         'los 4 faldones son la MISMA pieza; punta larga = canto SUP.'),
        ('T2', 'Tirante de rodilla', str(N_CERCHAS), '22.5°', '0°',
         frac(TIRANTE_LARGA), frac(TIRANTE_CORTA), frac(CARA_TOPE),
         'OJO: aquí la punta larga es el canto INFERIOR'),
        ('T3', 'Cordón inferior', str(N_CERCHAS), '0°', '0°', frac(CORDON),
         frac(CORDON), frac(S2x4[0]), 'a escuadra en los dos extremos'),
        ('T4', 'Cola de alero', str(D.N_COLAS), '22.5°', '0°', frac(ALERO_LARGO),
         frac(ALERO_LARGO), frac(CARA_TOPE),
         'cortes PARALELOS: los dos cantos miden igual'),
        ('T5', 'Travesaño de vuelo', '16', '0°', '0°', frac(VUELO_HASTIAL),
         frac(VUELO_HASTIAL), frac(S2x4[0]), 'escalera de vuelo del hastial'),
    ]
    tabla(h, tx, 302, [26, 84, 24, 36, 26, 56, 56, 46, 194],
          ['MARCA', 'PIEZA', '>CANT', '>INGLETE', '>BISEL', '>PUNTA LARGA',
           '>PUNTA CORTA', '>CARA CORTE', 'OBSERVACIONES'], filas,
          size=6.1, lead=10.0, cab_size=5.6, resaltar=(0,))

    # --- cómo trazar ----------------------------------------------------------
    h.texto(tx, 222, 'CÓMO TRAZAR LA PLANTILLA (una sola vez, para las 5 cerchas)',
            9.0, 'Helvetica-Bold')
    pasos = [
        f'1.  Sobre una hoja de 4x8 o sobre el suelo, traza una recta y marca en ella '
        f'los {frac(ANCHO)} del cordón inferior. Marca el centro.',
        f'2.  Con una cuerda o un compás de vara, desde el centro traza el arco de '
        f'{frac(R)}: corta la recta en los dos ALEROS y da la CUMBRERA.',
        f'3.  Traza las dos radiales a 45°. Donde cortan el arco están las dos RODILLAS. '
        f'Ya tienes los cinco puntos de trabajo.',
        f'4.  Traza el segundo arco de {frac(R_INTERIOR, 32)}. Donde corta la recta y las '
        f'dos radiales están las tres ESQUINAS INTERIORES de los ingletes.',
        f'5.  Clava topes de 2x4 por fuera del contorno. Monta la PRIMERA cercha sobre la '
        f'plantilla y compruébala antes de cortar las otras cuatro.',
        f'6.  Corta cada cabio desde su propio trazo, NUNCA encadenando medidas: '
        f'{frac(CUERDA)} son {CUERDA:.4f}" y cuatro redondeos seguidos se notan en la cumbrera.',
        f'7.  Los dos ingletes de un cabio son de MANO CONTRARIA: convergen hacia el canto '
        f'inferior. Da la vuelta a la tabla manteniendo el mismo canto contra la guía.',
        f'8.  Cartelas de 1/2" contrachapado en las DOS caras de la rodilla (14" x 14") y de '
        f'la cumbrera (24" x 9"), con tornillos de 1 5/8" a 3".',
        f'9.  En el talón NO va cartela de contrachapado: las dos colas de alero, una por '
        f'cara, solapan {frac(ALERO_SOLAPE)} sobre cabio y cordón y hacen de cartela.',
    ]
    yy = 210
    for p in pasos:
        h.texto(tx, yy, p, 6.3, 'Helvetica')
        yy -= 9.4
    c.showPage()


# ===========================================================================
#  A-6  DETALLES
# ===========================================================================
CELDAS = [(28, 322, 236, 246), (274, 322, 236, 246), (520, 322, 244, 246),
          (28, 92, 236, 220), (274, 92, 236, 220), (520, 92, 244, 220)]


def _celda(h, k, n, titulo, esc, alto_notas):
    """Marco + título del detalle.  Devuelve (x, y, w, h, y_notas, recorte)."""
    x, y, w, hh = CELDAS[k]
    h.caja(x, y, w, hh, relleno=None, lw=0.6)
    h.titulo_vista(x + 6, y + hh - 16, n, titulo, esc)
    ry = y + alto_notas
    return x, y, w, hh, y + alto_notas - 6, (x + 3, ry, w - 6, hh - 26 - alto_notas)


def hoja_A6(c):
    h = Hoja(c, 'A-6', 'DETALLES CONSTRUCTIVOS', 'SEGÚN SE INDICA')

    # ---- 7. TALÓN Y ALERO --------------------------------------------------
    x, y, w, hh, yn, rc = _celda(h, 0, 7, 'TALÓN Y ALERO ACAMPANADO',
                                 '1" = 1\'-0"', 62)
    h.recorte(*rc)
    v = h.vista(escala(1.0), rc[0] + rc[2] / 2 - 12, rc[1] + rc[3] / 2 - 6)
    for k in ('cordon', 'cabio_bajo_d', 'cola_d'):
        v.poli([(u - 30, val) for (u, val) in PIEZAS[k]], True, 0.9, black,
               white if k != 'cola_d' else None)
    v.rayado([(u - 30, val) for (u, val) in PIEZAS['cordon']], 3.0, 45)
    v.poli([(u - 30, val) for (u, val) in PIEZAS['cola_d']], True, 1.1, ROJO)
    v.circ(6, 0, 0.8, 0.6, ROJO, ROJO)
    v.angulo((6, 0), 112.5, 180, 8, '67.5°', 6.8, ROJO, rtxt=11)
    v.angulo((6, 0), -22.5, 0, 10, '22.5°', 6.4, ROJO, rtxt=13)
    v.linea(6, 0, 19, 0, 0.35, GRIS, [2.5, 2])
    v.cota_h(6, 18, ALERO_PUNTA[1] - 4.6, frac(ALERO_VUELO), off=-11, size=5.0)
    v.cota_v(ALERO_PUNTA[1], 0, 19.5, frac(ALERO_CAIDA, 32), off=13, size=5.0)
    v.texto(-15, -6.4, 'CORDÓN 2x4', 5.0, 'Helvetica', GRIS)
    v.texto(-14, 9.5, 'COLA DE ALERO 2x4', 5.0, 'Helvetica-Bold', ROJO)
    v.texto(-14, 5.7, 'UNA POR CARA', 5.0, 'Helvetica', ROJO)
    v.texto(-2, 13.5, 'CABIO BAJO', 5.0, 'Helvetica', GRIS)
    h.fin_recorte()
    h.parrafo(x + 7, yn, [
        f'· Vuela {frac(ALERO_VUELO)} y baja {frac(ALERO_CAIDA, 32)}: 22.5° justos, el mismo reglaje.',
        f'· Largo {frac(ALERO_LARGO)} en los dos cantos (cortes paralelos).',
        f'· Solapa {frac(ALERO_SOLAPE)} sobre cabio y cordón: LAS DOS COLAS SON',
        '  LA CARTELA DEL TALÓN. Ahí no va contrachapado.',
        '· 6 tornillos de 3" por cola, en dos hileras.',
        f'· El cabio sólo apoya {frac(CARA_TOPE)} sobre el cordón, y justo en',
        '  su testa: todo el empuje lo cosen las colas.',
    ], 5.6, 7.2)

    # ---- 8. RODILLA --------------------------------------------------------
    x, y, w, hh, yn, rc = _celda(h, 1, 8, 'UNIÓN DE RODILLA', '1" = 1\'-0"', 62)
    h.recorte(*rc)
    v = h.vista(escala(1.0), rc[0] + rc[2] / 2 - P_RODILLA_D[0] * 6,
                rc[1] + rc[3] / 2 - 25.5 * 6)
    for k in ('cabio_bajo_d', 'cabio_alto_d', 'tirante'):
        v.poli(PIEZAS[k], True, 0.9, black, white)
    gx, gy = P_RODILLA_D
    v.rect(gx - 10, gy - 11, 15, 15, 0.7, VERDE, None, [2.4, 2])
    v.circ(gx, gy, 0.8, 0.6, ROJO, ROJO)
    v.angulo((gx, gy), 157.5, 292.5, 6.0, '135°', 6.8, ROJO, rtxt=9.0)
    v.circ(*ESQ_RODILLA, 0.7, 0.6, AZUL, white)
    v.texto(gx + 8, gy + 6, 'CARTELA 1/2"  14"x14"', 5.0, 'Helvetica-Bold', VERDE)
    v.texto(gx + 8, gy + 1.6, 'LAS DOS CARAS', 5.0, 'Helvetica', VERDE)
    v.texto(ESQ_RODILLA[0] - 2.5, ESQ_RODILLA[1] - 4.5, 'ESQUINA INTERIOR', 5.0,
            'Helvetica', AZUL, al='r')
    v.texto(gx - 13, gy - 4.4, 'TIRANTE', 5.0, 'Helvetica', GRIS, al='r')
    v.texto(gx - 3, gy + 9, 'CABIO ALTO', 5.0, 'Helvetica', GRIS, al='r')
    v.texto(gx + 1.5, gy - 16, 'CABIO BAJO', 5.0, 'Helvetica', GRIS)
    h.fin_recorte()
    h.parrafo(x + 7, yn, [
        '· Quiebro de 45°: inglete de 22.5° en las DOS piezas.',
        '· El tirante topa contra la CARA INTERIOR de los cabios',
        '  BAJOS, con su canto superior en la esquina interior.',
        '· Contra el cabio bajo (67.5°) el corte vuelve a ser 22.5°.',
        '  Contra el cabio ALTO pediría 67.5°: fuera de sierra.',
        '· La rodilla es la rótula del gambrel: sin tirante y sin',
        '  cartelas la cercha se abre. No se pueden omitir.',
    ], 5.6, 7.2)

    # ---- 9. CUMBRERA -------------------------------------------------------
    x, y, w, hh, yn, rc = _celda(h, 2, 9, 'CUMBRERA', '1" = 1\'-0"', 56)
    h.recorte(*rc)
    v = h.vista(escala(1.0), rc[0] + rc[2] / 2, rc[1] + rc[3] / 2 - 32 * 6)
    for k in ('cabio_alto_d', 'cabio_alto_i'):
        v.poli(PIEZAS[k], True, 0.9, black, white)
    v.rect(-12, FLECHA - 10.5, 24, 9, 0.7, VERDE, None, [2.4, 2])
    v.circ(0, FLECHA, 0.8, 0.6, ROJO, ROJO)
    v.angulo(P_CUMBRERA, 202.5, 337.5, 5.5, '135°', 6.8, ROJO, rtxt=8.5)
    v.angulo(P_CUMBRERA, -22.5, 0, 8, '22.5°', 6.4, ROJO, rtxt=10.5)
    v.linea(-17, FLECHA, 17, FLECHA, 0.35, GRIS, [2.5, 2])
    v.cota_v(R_INTERIOR, FLECHA, 1.5, frac(CARA_TOPE), off=12, size=5.0)
    v.texto(0, FLECHA - 13.5, 'CARTELA 1/2"  24"x9"  ·  LAS DOS CARAS', 5.0,
            'Helvetica-Bold', VERDE, al='c')
    h.fin_recorte()
    h.parrafo(x + 7, yn, [
        '· Corte a plomo del cabio alto: inglete 22.5°, bisel 0°.',
        f'· Cara de tope {frac(CARA_TOPE)} contra el cabio opuesto.',
        '· Sin jabalcón ni tabla de cumbrera: la cartela en las dos',
        '  caras hace todo el trabajo.',
        f'· El intradós de la cumbrera queda a {pies(Z_ARRANQUE + R_INTERIOR)}.',
        '· Entre cerchas, taco de 2x4 en la cumbrera.',
    ], 5.6, 7.2)

    # ---- 10. POSTE / PATÍN / ANCLAJE --------------------------------------
    x, y, w, hh, yn, rc = _celda(h, 3, 10, 'POSTE, PATÍN Y ANCLAJE',
                                 '1/2" = 1\'-0"', 48)
    h.recorte(*rc)
    v = h.vista(escala(0.5), rc[0] + rc[2] / 2, rc[1] + rc[3] / 2 + 3)
    terreno(v, -22, 22, 0, False)
    v.rect(-11, -GRAVA, 22, GRAVA, 0.5, GRIS, None, [1.4, 1.4])
    v.rect(-S4x6[1] / 2, 0, S4x6[1], Z_PATIN_SUP, 0.9, black, white)
    v.rect(-POSTE / 2, Z_PATIN_SUP, POSTE, 22, 0.9, black, white)
    v.rect(-POSTE / 2 - 0.5, Z_PATIN_SUP, 0.5, 7, 0.6, AZUL, AZUL)
    v.rect(POSTE / 2, Z_PATIN_SUP, 0.5, 7, 0.6, AZUL, AZUL)
    v.poli([(-14, 3), (-14, -20)], False, 1.2, ROJO)
    v.poli([(-16.5, -20), (-11.5, -20), (-14, -25)], True, 1.0, ROJO)
    v.poli([(-14, 3), (-POSTE / 2 - 0.5, 12)], False, 1.2, ROJO)
    v.texto(4, 18, 'POSTE 4x4 PT', 5.0, 'Helvetica')
    v.texto(4, 1.2, 'PATÍN 4x6 PT', 5.0, 'Helvetica')
    v.texto(4, Z_PATIN_SUP + 8, 'BASE GALVANIZADA', 5.0, 'Helvetica-Bold', AZUL)
    v.texto(-16, -10, 'ANCLAJE', 5.2, 'Helvetica-Bold', ROJO, al='r')
    v.texto(-16, -15, 'HELICOIDAL 30"', 5.2, 'Helvetica-Bold', ROJO, al='r')
    v.texto(-16, -20, '~3000 lb', 5.0, 'Helvetica', ROJO, al='r')
    v.texto(-16, 8, 'FLEJE + TENSOR', 5.0, 'Helvetica', ROJO, al='r')
    v.texto(4, -GRAVA / 2 - 1, f'GRAVA #57 {frac(GRAVA)}', 5.0, 'Helvetica', GRIS)
    h.fin_recorte()
    h.parrafo(x + 7, yn, [
        f'· Levante {LEVANTE:.0f} lb frente a {RESISTE:.0f} lb de peso propio:',
        '  SIN ANCLAR, EL VIENTO SE LA LLEVA.',
        f'· {ANCLAJES} anclajes x {ANCLAJE_CAPACIDAD:.0f} lb cubren el levante con margen.',
        '· Camino de cargas: cumbrera > cabio > cordón > herraje',
        '  antihuracán > carrera > capitel > poste > base > anclaje.',
    ], 5.6, 7.2)

    # ---- 11. JABALCÓN ------------------------------------------------------
    x, y, w, hh, yn, rc = _celda(h, 4, 11, 'JABALCÓN A 45°', '1/2" = 1\'-0"', 48)
    h.recorte(*rc)
    v = h.vista(escala(0.5), rc[0] + rc[2] / 2 - 20 * 3, rc[1] + rc[3] / 2 - 33 * 3)
    v.rect(0, 10, POSTE, 34, 0.9, black, white)
    v.rect(0, 44, 40, S2x8[1], 0.9, black, white)
    p0 = (POSTE, 44 - JABALCON_CATETO)
    p1 = (POSTE + JABALCON_CATETO, 44)
    n = S2x4[1] / math.sqrt(2)
    v.poli([p0, p1, (p1[0] - n, p1[1] - n), (p0[0] + n, p0[1] - n)], True, 1.1, ROJO)
    v.angulo(p0, 0, 45, 8, '45°', 6.4, ROJO, rtxt=11)
    v.cota_v(44 - JABALCON_CATETO, 44, -1, frac(JABALCON_CATETO), off=-11, size=5.0)
    v.cota_h(POSTE, POSTE + JABALCON_CATETO, 44 + S2x8[1], frac(JABALCON_CATETO),
             off=11, size=5.0)
    v.cota_al(p0, p1, frac(JABALCON_LARGA), off=12, size=5.4, lado=1)
    v.texto(1.2, 14, 'POSTE 4x4', 5.0, 'Helvetica', black, rot=90, dx=2.2)
    v.texto(22, 46.4, 'CARRERA 2x8', 5.0, 'Helvetica', black, al='c')
    h.fin_recorte()
    h.parrafo(x + 7, yn, [
        f'· 2x4 PT. Punta larga {frac(JABALCON_LARGA)}, punta corta {frac(JABALCON_CORTA)}.',
        '· 45° en los dos extremos, cortes PARALELOS.',
        '· 8 unidades: 4 esquinas x 2 direcciones.',
        '· 2 tornillos estructurales 1/4" x 4" en cada extremo.',
        '· Con los cuatro lados abiertos son el único plano de',
        '  cortante junto con el tablero de cubierta: NO omitir.',
    ], 5.6, 7.2)

    # ---- 12. CARRERA ARMADA ------------------------------------------------
    x, y, w, hh, yn, rc = _celda(h, 5, 12, 'CARRERA ARMADA Y CAPITEL',
                                 '1" = 1\'-0"', 48)
    h.recorte(*rc)
    v = h.vista(escala(1.0), rc[0] + rc[2] / 2 - 2 * 6, rc[1] + rc[3] / 2 - 9 * 6)
    v.rect(-POSTE / 2, 0, POSTE, 7, 0.9, black, white)
    v.rect(-VIGA_ANCHO / 2, 7, S2x8[0], S2x8[1], 0.9, black, white)
    v.rect(VIGA_ANCHO / 2 - S2x8[0], 7, S2x8[0], S2x8[1], 0.9, black, white)
    v.rect(-0.25, 7, 0.5, S2x8[1], 0.7, VERDE, None, [1.6, 1.4])
    v.rect(-1.75, 7 + S2x8[1], 9, ANCHO_CABIO, 0.9, black, white)
    v.rect(-POSTE / 2 - 0.5, 4, POSTE + 1, 6, 0.6, AZUL, None)
    v.cota_h(-VIGA_ANCHO / 2, VIGA_ANCHO / 2, 7 + S2x8[1] + ANCHO_CABIO,
             frac(VIGA_ANCHO), off=13, size=5.2)
    v.cota_v(7, 7 + S2x8[1], VIGA_ANCHO / 2 + 10, frac(S2x8[1]), off=12, size=5.2)
    v.texto(7.6, 7 + S2x8[1] + 1.2, 'CORDÓN DE LA CERCHA', 5.0, 'Helvetica')
    v.texto(0.9, 9, 'ALMA 1/2"', 4.8, 'Helvetica-Bold', VERDE, rot=90)
    v.texto(-POSTE / 2 - 1.5, 5.5, 'CAPITEL 4x4', 5.0, 'Helvetica-Bold', AZUL,
            al='r')
    h.fin_recorte()
    h.parrafo(x + 7, yn, [
        f'· 2 tablas de 2x8 PT + alma de 1/2" contrachapado = {frac(VIGA_ANCHO)}',
        '  justos, el mismo ancho que el poste: entra el capitel',
        '  estándar de 4x4 sin calzar.',
        f'· El cordón de la cercha apoya {frac(APOYO_CORDON)} en cada carrera.',
        '· 2 herrajes antihuracán por cercha, uno en cada apoyo.',
        '· Clavado del armado: 2 filas de clavos 10d a 12".',
    ], 5.6, 7.2)
    c.showPage()


# ===========================================================================
#  A-7  LISTA DE CORTE
# ===========================================================================
def hoja_A7(c):
    h = Hoja(c, 'A-7', 'LISTA DE CORTE', 'NTS')
    x0, y0, x1, y1 = AREA
    h.texto(x0, y1 - 12, 'LISTA DE CORTE — POR PIEZA', 13, 'Helvetica-Bold')
    h.texto(x0, y1 - 24, 'Todas las longitudes salen de la geometría de la hoja '
            'A-5. Verifica siempre contra la plantilla antes de cortar en serie.',
            6.8, 'Helvetica', GRIS)
    anchos = [30, 30, 96, 66, 108, 406]
    cab = ['MARCA', '>CANT', 'MATERIAL', '>LARGO', 'ÁNGULOS', 'DESTINO']
    yy = y1 - 36
    for sec, piezas in D.SECCIONES:
        h.texto(x0, yy, sec, 8.0, 'Helvetica-Bold', ROJO)
        filas = []
        for p in piezas:
            largo = frac(p['largo']) if p['largo'] else 'hoja 4x8'
            dest = p['donde'] + (f"  [{p['nota']}]" if p['nota'] else '')
            filas.append((p['marca'], p['qty'], p['mat'], largo,
                          p['ang'][:30], dest[:104]))
        yy = tabla(h, x0, yy - 5, anchos, cab, filas, size=6.0, lead=8.8,
                   cab_size=5.6) - 11
    h.caja(x0, y0 + 22, 492, 46, relleno=None)
    h.parrafo(x0 + 8, y0 + 56, [
        '**ANTES DE CORTAR',
        '· Toda la madera en contacto con el terreno o con agua jabonosa va TRATADA (PT).',
        f'· Los {D.N_CABIOS} cabios T1 son la misma pieza: corta uno, compruébalo en la plantilla y úsalo de patrón.',
        '· Ingletadora en 22.5°, bisel 0°, tabla plana. El único corte a escuadra de la cercha es el cordón T3.',
    ], 6.2, 8.2)
    c.showPage()


# ===========================================================================
#  A-8  LISTA DE COMPRA, SECUENCIA Y SEGURIDAD
# ===========================================================================
def hoja_A8(c):
    h = Hoja(c, 'A-8', 'COMPRA Y SECUENCIA', 'NTS')
    x0, y0, x1, y1 = AREA
    h.texto(x0, y1 - 12, 'LISTA DE COMPRA — LARGOS COMERCIALES', 13,
            'Helvetica-Bold')
    h.texto(x0, y1 - 24, 'Calculada con optimización de corte real sobre las '
            'longitudes que se venden, no estimada a ojo.', 6.8, 'Helvetica', GRIS)

    filas = []
    for cc in D.compra_madera():
        if not cc:
            continue
        mix = ' + '.join(f'{n} de {ft} ft' for ft, n in cc['tablas'].items())
        filas.append((cc['material'], mix, f"{cc['pies_totales']:.0f} ft",
                      f"{cc['pies_cortados']:.1f} ft", f"{cc['merma']*100:.0f} %"))
    yy = tabla(h, x0, y1 - 36, [92, 150, 62, 68, 50],
               ['MADERA', 'COMPRAR', '>TOTAL', '>EN CORTES', '>MERMA'], filas,
               size=6.4, lead=9.6)
    yy -= 16
    h.texto(x0, yy, 'TABLEROS', 8.0, 'Helvetica-Bold', ROJO)
    filas = [(t['mat'], f"{t['hojas']} hojas de 4x8", t['detalle'][:78])
             for t in D.compra_tableros()]
    yy = tabla(h, x0, yy - 5, [130, 74, 218], ['MATERIAL', '>CANT', 'PARA'],
               filas, size=6.4, lead=9.6) - 16

    h.texto(x0, yy, 'HERRAJES, CUBIERTA Y VARIOS', 8.0, 'Helvetica-Bold', ROJO)
    filas = [(q, d[:54], n[:56]) for q, d, n in D.HERRAJES]
    yy = tabla(h, x0, yy - 5, [30, 190, 202], ['>CANT', 'CONCEPTO', 'OBSERVACIONES'],
               filas, size=6.2, lead=8.6)

    # --- columna derecha -----------------------------------------------------
    rx = x0 + 440
    h.texto(rx, y1 - 12, 'SECUENCIA DE MONTAJE', 11, 'Helvetica-Bold')
    pasos = [
        'Replantea 8\'-8" x 6\'-8", retira la capa vegetal y extiende el geotextil.',
        f'Extiende y compacta {frac(GRAVA)} de grava #57. NIVELA: todo lo demás depende de esto.',
        f'Coloca los 2 patines 4x6 PT de {frac(LARGO)}. Comprueba escuadra por diagonales '
        f'({math.hypot(LARGO, ANCHO):.2f}") y nivel en las dos direcciones.',
        'Clava los 4 anclajes helicoidales y deja el fleje suelto: se tensa al final.',
        f'Bases de poste y 4 postes 4x4 de {frac(POSTE_LARGO)}, aplomados y apuntalados.',
        f'Arma las 2 carreras (2 x 2x8 + alma de 1/2"), móntalas sobre los capiteles '
        f'a {pies(Z_VIGA_SUP)} y añade las 2 carreras de extremo.',
        'Los 8 jabalcones a 45°. AHORA, antes de quitar los puntales.',
        f'Plataforma: largueros, 3 viguetas y los 20 bloqueos. TALADRA LOS 10 HUECOS '
        f'ANTES de atornillar el tablero definitivamente.',
        f'Traza la plantilla de la cercha (hoja A-5) y arma las {N_CERCHAS} cerchas en el suelo.',
        f'Iza las cerchas a {frac(SEP_CERCHAS)} O.C., 2 herrajes antihuracán cada una, '
        f'y arriostra provisionalmente.',
        f'Escaleras de vuelo de {frac(VUELO_HASTIAL)} en los dos hastiales.',
        'Tablero de cubierta en fajas, empezando por el alero. Fieltro y teja: 6 clavos '
        'por pieza y sellado a mano en el faldón bajo.',
        'Colas de alero, fascia, sofito y perfil del hastial. Cierra los dos hastiales.',
        'Tensa los 4 anclajes. Lija, redondea cantos y sella. Cuelga las 10 cubetas.',
    ]
    yy = y1 - 26
    for i, p in enumerate(pasos, 1):
        lin, act = [], ''
        for w in p.split():
            if len(act) + len(w) + 1 > 52:
                lin.append(act)
                act = w
            else:
                act = (act + ' ' + w).strip()
        lin.append(act)
        h.texto(rx, yy, f'{i:2d}.', 6.4, 'Helvetica-Bold', ROJO)
        for k, l in enumerate(lin):
            h.texto(rx + 14, yy - k * 7.8, l, 6.3, 'Helvetica')
        yy -= len(lin) * 7.8 + 2.6

    yy -= 8
    h.caja(rx, yy - 122, 296, 122, relleno=CREMA, borde=ROJO, lw=1.1)
    h.texto(rx + 8, yy - 13, 'SEGURIDAD — USO INFANTIL', 9.4, 'Helvetica-Bold', ROJO)
    h.parrafo(rx + 8, yy - 25, [
        'A.  Los 4 anclajes al terreno y los 8 jabalcones son ELEMENTOS',
        '     ESTRUCTURALES. No se pueden dejar para más adelante.',
        'B.  Estructura abierta y sin planta alta: no hay riesgo de caída',
        '     en altura. Tampoco hay puertas ni ventanas que atrapen dedos.',
        'C.  Avellana todos los tornillos y redondea los cantos vistos con',
        '     radio de 1/8" mínimo. Repasa después de cada temporada.',
        f'D.  Zona de caída libre de {pies(72)} alrededor, con {frac(9)} de mantillo o césped.',
        'E.  Acabado exterior bajo en COV, apto para contacto con niños.',
        'F.  El agua jabonosa lo pudre todo: pendiente de 1/8" por pie hacia',
        '     fuera y toda la plataforma en madera tratada.',
        'G.  Revisa el apriete de herrajes y la tensión de los anclajes cada',
        '     temporada, y siempre después de un temporal.',
    ], 6.1, 8.0)
    c.showPage()


# ===========================================================================
def main():
    ok, lineas = comprobar()
    if not ok:
        raise SystemExit('La geometría no cierra:\n  ' +
                         '\n  '.join(l for l in lineas if l.startswith('FALLO')))
    c = nuevo(SALIDA)
    for f in (hoja_A0, hoja_A1, hoja_A2, hoja_A3, hoja_A4, hoja_A5, hoja_A6,
              hoja_A7, hoja_A8):
        f(c)
    c.save()
    print(f'{SALIDA}: {len(lineas)} comprobaciones OK, 9 hojas.')


if __name__ == '__main__':
    main()
