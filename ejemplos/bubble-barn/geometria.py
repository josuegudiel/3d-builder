"""
Bubble Barn — geometría del plano nuevo.  FUENTE ÚNICA DE VERDAD.

Todo en PULGADAS.  Ninguna cota del plano está escrita a mano: todas salen
de aquí.  Ejecuta este fichero para ver la autocomprobación.

Ejes:
    X   a lo largo de los 8'-0"   (0 .. 96)
    Y   a lo ancho  de los 6'-0"  (0 .. 72)
    Z   altura sobre el terreno acabado (cara superior de la grava)

La cercha se dibuja en su propio sistema (u, v):
    u = Y - 36   (medio vano, -36 .. +36)
    v = altura sobre la LÍNEA DE ARRANQUE del tejado (= canto superior del
        cordón inferior = 84" sobre el terreno)
"""
import math

# ===========================================================================
# 1. Escuadrías reales de la madera americana
# ===========================================================================
S2x4 = (1.5, 3.5)
S2x6 = (1.5, 5.5)
S2x8 = (1.5, 7.25)
S4x4 = (3.5, 3.5)
S4x6 = (3.5, 5.5)

# ===========================================================================
# 2. Encargo del cliente
# ===========================================================================
ANCHO = 72.0            # 6'-0"  (luz de la cercha)
LARGO = 96.0            # 8'-0"
ARRANQUE_TECHO = 84.0   # 7'-0" del terreno a donde EMPIEZA el techo
ALTURA_TERMINADA = 132.0  # 11'-0" del terreno a lo MAS ALTO del acabado
N_CUBETAS = 10
ALTO_CUBETA = 14.5      # cubeta de 5 galones
DIAM_HUECO = 11.0       # hueco en el tablero (verificar con la cubeta real)

# ===========================================================================
# 3. Cubierta gambrel
# ---------------------------------------------------------------------------
# Los angulos NO se eligen: se deducen de exigir UN SOLO reglaje de sierra.
#   asiento del cabio bajo ...... inglete = 90 - tB
#   union de rodilla ............ inglete = (tB - tA)/2
#   cumbrera .................... inglete = tA
# Igualando los tres:  tB + tA = 90  y  tB = 3*tA   ->   tA = 22.5, tB = 67.5.
# Es la unica solucion, y NO depende de las longitudes: vale para cualquier
# flecha.  Lo que si depende de la flecha es si los cabios salen iguales:
# solo lo son cuando la flecha vale luz/2.  Aqui no.
# ===========================================================================
ANG_ALTO = math.radians(22.5)   # cabio alto sobre la horizontal
ANG_BAJO = math.radians(67.5)   # cabio bajo sobre la horizontal
INGLETE = 22.5                  # grados desde escuadra, bisel 0, tabla plana

MEDIA_LUZ = ANCHO / 2                            # 36"

# --- Canto de la cubierta, medido EN VERTICAL en la cumbrera ---------------
# El tablero, el fieltro y la teja se miden PERPENDICULARES al faldon; en el
# vertice del tejado esa distancia se ve dividida por cos(22.5).  La caperuza
# se dobla sobre la arista, asi que su espesor YA es vertical y se suma tal
# cual, sin dividir.
#
# Los espesores por defecto son de TEJA ARQUITECTONICA (laminada) con caperuza
# de perfil alto.  Si se pone otra cosa, cambia la flecha: ver tabla_paquetes().
ESP_TABLERO_CUB = 0.5      # contrachapado
ESP_FIELTRO = 0.030        # fieltro asfaltico #15 (ASTM D226 tipo I)
ESP_TEJA = 0.375           # teja arquitectonica en la zona de doble lamina
ESP_CABALLETE = 0.45       # caperuza de cumbrera de perfil alto


def canto_cubierta(ply=None, fieltro=None, teja=None, cap=None):
    ply = ESP_TABLERO_CUB if ply is None else ply
    fieltro = ESP_FIELTRO if fieltro is None else fieltro
    teja = ESP_TEJA if teja is None else teja
    cap = ESP_CABALLETE if cap is None else cap
    return (ply + fieltro + teja) / math.cos(ANG_ALTO) + cap


CANTO_CUBIERTA = canto_cubierta()

# --- Flecha: sale de los 11'-0" TERMINADOS, no al reves --------------------
FLECHA = ALTURA_TERMINADA - ARRANQUE_TECHO - CANTO_CUBIERTA   # 46.9382"

# --- Cuerdas: dos ecuaciones de cierre, dos incognitas ---------------------
#   cos(tB)*LB + cos(tA)*LA = media luz     (cierre horizontal)
#   sin(tB)*LB + sin(tA)*LA = flecha        (cierre vertical)
_cb, _sb = math.cos(ANG_BAJO), math.sin(ANG_BAJO)
_ca, _sa = math.cos(ANG_ALTO), math.sin(ANG_ALTO)
_det = _cb * _sa - _ca * _sb
CUERDA_BAJA = (MEDIA_LUZ * _sa - _ca * FLECHA) / _det       # 41.8447"
CUERDA_ALTA = (_cb * FLECHA - MEDIA_LUZ * _sb) / _det       # 21.6335"

CARRERA_BAJA = CUERDA_BAJA * _cb        # avance del cabio bajo, 16.0133"
CARRERA_ALTA = CUERDA_ALTA * _ca        # avance del cabio alto, 19.9867"
FLECHA_BAJA = CUERDA_BAJA * _sb         # subida del cabio bajo, 38.6594"
FLECHA_ALTA = CUERDA_ALTA * _sa         # subida del cabio alto,  8.2788"

# Los cinco puntos de trabajo, sobre el canto SUPERIOR de los cabios
P_ALERO_D = (MEDIA_LUZ, 0.0)
P_RODILLA_D = (MEDIA_LUZ - CARRERA_BAJA, FLECHA_BAJA)
P_CUMBRERA = (0.0, FLECHA)
P_RODILLA_I = (-P_RODILLA_D[0], P_RODILLA_D[1])
P_ALERO_I = (-MEDIA_LUZ, 0.0)
P = [P_ALERO_D, P_RODILLA_D, P_CUMBRERA, P_RODILLA_I, P_ALERO_I]

ANCHO_CABIO = S2x4[1]                           # 3.5" en el plano de la cercha
RETRANQUEO = ANCHO_CABIO * math.tan(ANG_ALTO)   # 1.4497" por corte
CARA_TOPE = ANCHO_CABIO / math.cos(ANG_ALTO)    # 3.7884" de cara de apoyo

CABIO_BAJO_LARGA = CUERDA_BAJA                       # canto SUPERIOR
CABIO_BAJO_CORTA = CUERDA_BAJA - 2 * RETRANQUEO      # canto inferior
CABIO_ALTO_LARGA = CUERDA_ALTA
CABIO_ALTO_CORTA = CUERDA_ALTA - 2 * RETRANQUEO

# Pendientes de escuadra de carpintero (subida por cada 12" de avance)
PEND_BAJA = 12 * math.tan(ANG_BAJO)             # 28.97 en 12
PEND_ALTA = 12 * math.tan(ANG_ALTO)             # 4.97 en 12


def resolver_cuerdas(flecha):
    """Devuelve (cuerda baja, cuerda alta) para una flecha cualquiera."""
    return ((MEDIA_LUZ * _sa - _ca * flecha) / _det,
            (_cb * flecha - MEDIA_LUZ * _sb) / _det)


PAQUETES = [
    ('Teja arquitectónica + caperuza de perfil alto  (ESTE PLANO)',
     0.5, 0.030, 0.375, 0.45),
    ('Teja arquitectónica gruesa + caperuza de perfil alto',
     0.5, 0.030, 0.5, 0.45),
    ('Teja 3-tab + caperuza 3-tab', 0.5, 0.030, 0.25, 0.25),
    ('Chapa metálica sobre tablero + caballete', 0.5, 0.030, 0.03, 0.5),
]


def tabla_paquetes():
    """Para cada paquete de cubierta: canto, flecha y las dos cuerdas."""
    out = []
    for nom, ply, fi, te, cap in PAQUETES:
        canto = canto_cubierta(ply, fi, te, cap)
        fl = ALTURA_TERMINADA - ARRANQUE_TECHO - canto
        lb, la = resolver_cuerdas(fl)
        out.append((nom, canto, fl, lb, la))
    return out


# Cuanto mueve cada 1/16" de espesor de paquete
SENSIBILIDAD_BAJA = (1 / 16) / math.cos(ANG_ALTO) * 1.30656
SENSIBILIDAD_ALTA = (1 / 16) / math.cos(ANG_ALTO) * 0.54120


# --- Rectas de canto de los cabios -----------------------------------------
def _recta(p0, ang, hacia_dentro):
    """(punto, dirección) del canto SUPERIOR o de la cara INTERIOR."""
    ux, uy = math.cos(ang), math.sin(ang)
    return (p0, (ux, uy))


def _cara_interior(p_sup, dir_u):
    """Desplaza una recta 3.5" perpendicularmente hacia el interior."""
    ux, uy = dir_u
    nx, ny = -uy, ux
    if nx > 0:                       # la que apunta hacia el eje
        nx, ny = -nx, -ny
    return ((p_sup[0] + ANCHO_CABIO * nx, p_sup[1] + ANCHO_CABIO * ny), dir_u)


def _corta(r1, r2):
    (x1, y1), (a1, b1) = r1
    (x2, y2), (a2, b2) = r2
    det = a1 * (-b2) - (-a2) * b1
    t = ((x2 - x1) * (-b2) - (-a2) * (y2 - y1)) / det
    return (x1 + a1 * t, y1 + b1 * t)


# lado derecho (u > 0)
_DIR_BAJO = (math.cos(math.pi - ANG_BAJO), math.sin(math.pi - ANG_BAJO))   # alero -> rodilla
_DIR_ALTO = (math.cos(math.pi - ANG_ALTO), math.sin(math.pi - ANG_ALTO))   # rodilla -> cumbrera

_SUP_BAJO = (P_ALERO_D, _DIR_BAJO)
_SUP_ALTO = (P_RODILLA_D, _DIR_ALTO)
_INT_BAJO = _cara_interior(P_ALERO_D, _DIR_BAJO)
_INT_ALTO = _cara_interior(P_RODILLA_D, _DIR_ALTO)

# Esquina INTERIOR del inglete de rodilla: donde se cortan las dos caras
# interiores.  Cae 2.679" MÁS BAJA que el punto de trabajo — por eso el
# tirante NO puede ir a la altura del punto de trabajo (chocaría con el
# cabio alto).
ESQ_RODILLA = _corta(_INT_BAJO, _INT_ALTO)

# Las tres esquinas interiores del inglete.  Con la flecha de la version de
# 10 pies (luz/2) caian sobre un arco concentrico; con la flecha de 11 pies
# ya no, asi que la plantilla se replantea por coordenadas (tabla de la
# hoja A-5), que ademas es mas robusto.
_RETRANQUEO_ASIENTO = ANCHO_CABIO / math.tan(ANG_BAJO)   # 1.4497"
ESQ_ASIENTO = (MEDIA_LUZ - CARA_TOPE, 0.0)
ESQ_CUMBRERA = (0.0, FLECHA - CARA_TOPE)


def _x_cara_interior_bajo(v):
    """u de la cara interior del cabio bajo derecho a la altura v."""
    (x0, y0), (ux, uy) = _INT_BAJO
    return x0 + ux * (v - y0) / uy


# --- Tirante de rodilla ----------------------------------------------------
# 2x4 de canto, horizontal, con el canto SUPERIOR en la esquina interior del
# inglete de rodilla, topando contra las caras interiores de los CABIOS BAJOS.
# Contra el cabio bajo (67.5°) el corte es 90-67.5 = 22.5°: mismo reglaje.
TIRANTE_V_SUP = ESQ_RODILLA[1]
TIRANTE_V_INF = TIRANTE_V_SUP - ANCHO_CABIO
TIRANTE_CORTA = 2 * _x_cara_interior_bajo(TIRANTE_V_SUP)   # canto superior
TIRANTE_LARGA = 2 * _x_cara_interior_bajo(TIRANTE_V_INF)   # canto inferior
TIRANTE_PUNTO_A_PUNTO = 2 * P_RODILLA_D[0]                 # 50.9117" (trazado)

# --- Cordón inferior -------------------------------------------------------
CORDON = ANCHO                       # 72" a ESCUADRA (único corte a 0°)

# --- Cola de alero acampanado ---------------------------------------------
# El quiebro del alero (67.5 - 22.5) vale 45°, el MISMO que la rodilla.
# 2x4 a 22.5° BAJO la horizontal, cortes a plomo (paralelos) en los dos
# extremos: la pieza es un PARALELOGRAMO, los dos cantos miden igual.
# Va clavada en las DOS caras de cada cabio bajo y solapa el talón:
# las dos colas SON la cartela del talón.
ALERO_VUELO = 12.0                                  # sale 12" del punto de alero
ALERO_CAIDA = ALERO_VUELO * math.tan(ANG_ALTO)      # baja 4.9706"
ALERO_SOLAPE = 12.0                                 # solapa 12" hacia dentro
ALERO_LARGO = (ALERO_VUELO + ALERO_SOLAPE) / math.cos(ANG_ALTO)   # 25.978"
ALERO_PUNTA = (P_ALERO_D[0] + ALERO_VUELO, -ALERO_CAIDA)
ALERO_TALON = (P_ALERO_D[0] - ALERO_SOLAPE, ALERO_SOLAPE * math.tan(ANG_ALTO))
# Punto más bajo de la estructura de cubierta (canto inferior de la cola)
ALERO_V_MIN = ALERO_PUNTA[1] - ANCHO_CABIO / math.cos(ANG_ALTO)

# ===========================================================================
# 4. Cotas verticales sobre el terreno
# ===========================================================================
GRAVA = 4.0                          # lecho de grava #57 compactada
Z_PATIN_SUP = S4x6[0]                # 3.5"  — patín 4x6 tumbado
Z_ARRANQUE = ARRANQUE_TECHO          # 84"   — canto sup. del cordón inferior
Z_VIGA_SUP = Z_ARRANQUE - ANCHO_CABIO        # 80.5" — cara sup. de la carrera
Z_VIGA_INF = Z_VIGA_SUP - S2x8[1]            # 73.25"
POSTE_LARGO = Z_VIGA_INF - Z_PATIN_SUP       # 69.75"
Z_CUMBRERA = Z_ARRANQUE + FLECHA             # 120" = 10'-0" EXACTOS
Z_ALERO_MIN = Z_ARRANQUE + ALERO_V_MIN       # bajo la punta del alero

Z_PLATAFORMA = 20.0                          # cara superior del tablero
CANTO_VIGUETA = S2x6[1]                      # 5.5"
ESPESOR_TABLERO = 0.75
Z_VIGUETA_SUP = Z_PLATAFORMA - ESPESOR_TABLERO   # 19.25"
Z_VIGUETA_INF = Z_VIGUETA_SUP - CANTO_VIGUETA    # 13.75"
FONDO_CUBETA = Z_PLATAFORMA - ALTO_CUBETA        # 5.5" (caso peor: borde a ras)

# ===========================================================================
# 5. Postes, carreras y cerchas
# ===========================================================================
POSTE = S4x4[0]                       # 3.5"
# Los postes se RETRANQUEAN 1 1/2" del borde para que el larguero perimetral
# de la plataforma (2x6 de canto) solape su cara exterior y la huella siga
# midiendo 6'-0" x 8'-0" justos.  Sin esto el larguero atraviesa el poste.
RETRANQUEO_POSTE = S2x6[0]            # 1.5"
_a, _b = RETRANQUEO_POSTE + POSTE / 2, POSTE / 2
POSTES_XY = [(_a, _a), (LARGO - _a, _a), (_a, ANCHO - _a), (LARGO - _a, ANCHO - _a)]
VIGA_ANCHO = 2 * S2x8[0] + 0.5        # 2 x 2x8 + alma de 1/2" contrachapado = 3.5"
VIGA_Y = [(RETRANQUEO_POSTE, RETRANQUEO_POSTE + VIGA_ANCHO),
          (ANCHO - RETRANQUEO_POSTE - VIGA_ANCHO, ANCHO - RETRANQUEO_POSTE)]
APOYO_CORDON = VIGA_ANCHO             # 3.5" de apoyo del cordón en cada carrera
PATIN_Y = [(0.0, S4x6[1]), (ANCHO - S4x6[1], ANCHO)]

# Cerchas: las de hastial a haces con la testa de la carrera y las tres
# interiores repartidas.  Asi un EJE cae exactamente en X = 48", que es donde
# empalman los tableros de 4x8 de la cubierta: la junta queda apoyada.
N_CERCHAS = 5
POS_CERCHAS = [S2x4[0] / 2 + i * (LARGO - S2x4[0]) / (N_CERCHAS - 1)
               for i in range(N_CERCHAS)]                # ejes
SEP_CERCHAS = POS_CERCHAS[1] - POS_CERCHAS[0]            # 23.625" O.C.
VUELO_HASTIAL = 6.0
LARGO_CUBIERTA = LARGO + 2 * VUELO_HASTIAL               # 108"

# Superficie de cubierta: 4 faldones de cabio + 2 faldas de alero
DESARROLLO = 2 * (CUERDA_BAJA + CUERDA_ALTA) + 2 * ALERO_VUELO / math.cos(ANG_ALTO)
AREA_CUBIERTA = DESARROLLO * LARGO_CUBIERTA / 144.0

# Área de un hastial (polígono bajo la línea de tejado)
def _area_poligono(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


AREA_HASTIAL = _area_poligono([P_ALERO_I, P_RODILLA_I, P_CUMBRERA,
                               P_RODILLA_D, P_ALERO_D]) / 144.0

# Jabalcones a 45° poste-carrera
# Corte a 45° sobre una tabla que va a 45°: el retranqueo es 3.5 x tan45 = 3.5"
JABALCON_CATETO = 24.0
JABALCON_LARGA = JABALCON_CATETO * math.sqrt(2)                      # 33.941"
JABALCON_CORTA = JABALCON_LARGA - 2 * S2x4[1] * math.tan(math.radians(45))   # 26.941"

# ===========================================================================
# 6. Plataforma de cubetas
# ===========================================================================
RIM = S2x6[0]                         # 1.5"
VIGUETAS_X = [26.0, 48.0, 70.0]       # ejes de las viguetas (dirección Y)
LARGUERO_LARGO = LARGO                # 96" — solapa la cara exterior del poste
LARGUERO_CORTO = ANCHO - 2 * RIM      # 69" — entre los largueros largos
VIGUETA_LARGO = LARGUERO_CORTO        # 69"

CENTROS_HUECOS = (
    [(x, 14.0) for x in (15.0, 37.0, 59.0, 81.0)] +
    [(x, ANCHO - 14.0) for x in (15.0, 37.0, 59.0, 81.0)] +
    [(12.0, ANCHO / 2), (LARGO - 12.0, ANCHO / 2)]
)

# Bordes libres de cada bahía entre apoyos (rim / viguetas / rim)
_APOYOS_X = [RIM] + [v - RIM / 2 for v in VIGUETAS_X]
_BAHIAS = []
_bordes = [RIM] + sum([[v - RIM / 2, v + RIM / 2] for v in VIGUETAS_X], []) \
    + [LARGO - RIM]
for i in range(0, len(_bordes) - 1, 2):
    _BAHIAS.append((_bordes[i], _bordes[i + 1]))


def _bahia(x):
    for a, b in _BAHIAS:
        if a <= x <= b:
            return (a, b)
    return None


# Bloqueo 2x6 tangente a cada hueco, entre apoyos
BLOQUEOS = []            # (x0, x1, y_tangente)
for (cx, cy) in CENTROS_HUECOS:
    a, b = _bahia(cx)
    for yt in (cy - DIAM_HUECO / 2, cy + DIAM_HUECO / 2):
        BLOQUEOS.append((a, b, yt))
# quitar duplicados exactos (filas compartidas por varios huecos no se dan
# aquí porque cada hueco está en su propia bahía)
BLOQUEOS = sorted(set(BLOQUEOS))
LARGOS_BLOQUEO = sorted({round(b - a, 4) for a, b, _ in BLOQUEOS})

# ===========================================================================
# 7. Viento — al subir a 11 pies el vuelco casi se dobla
#    (estimacion ASCE 7, Tennessee, V=100 mph, Riesgo I, edificio ABIERTO)
# ===========================================================================
V_VIENTO = 100.0                 # mph
KZ, KD, G = 0.85, 0.85, 0.85
QZ = 0.00256 * (V_VIENTO ** 2) * KZ * KD         # ~18.5 psf

# --- peso propio, sumado del despiece real ---------------------------------
_LIN = {'2x4': 1.28, '2x4PT': 1.60, '2x6PT': 2.50, '2x8PT': 3.40,
        '4x4PT': 4.00, '4x6PT': 6.30, '1x4': 0.70, '1x6': 1.10}
_SUP = {'ply12': 1.50, 'plyPT34': 2.60, 'siding': 1.70, 'teja': 2.60}


def _peso_propio():
    lin = (154 * _LIN['2x4'] + 24 * _LIN['2x4PT'] + 88 * _LIN['2x6PT']
           + 44 * _LIN['2x8PT'] + 32 * _LIN['4x4PT'] + 16 * _LIN['4x6PT']
           + 48 * _LIN['1x4'] + 40 * _LIN['1x6'])
    sup = (AREA_CUBIERTA * _SUP['ply12'] + AREA_CUBIERTA * _SUP['teja']
           + LARGO * ANCHO / 144.0 * _SUP['plyPT34']
           + 2 * AREA_HASTIAL * _SUP['siding'])
    return lin + sup


PESO_PROPIO = _peso_propio()
PESO_CUBETAS = N_CUBETAS * 5 * 8.34              # 417 lb de liquido

# --- levante: depende del area EN PLANTA, no cambia con la altura ----------
CN_LEVANTE = 1.2
AREA_PLANTA = LARGO_CUBIERTA * (ANCHO + 2 * ALERO_VUELO) / 144.0   # sq ft
LEVANTE = QZ * CN_LEVANTE * AREA_PLANTA
RESISTE = 0.6 * PESO_PROPIO                      # 0.6*D, sin contar cubetas

# --- vuelco: SI cambia con la altura, y es lo que empeora -------------------
CF_LATERAL = 1.3
_A_CUBIERTA_LAT = FLECHA * LARGO_CUBIERTA / 144.0        # faldon visto de lado
_A_ALERO_LAT = (CARA_TOPE) * LARGO_CUBIERTA / 144.0      # fascia
_A_ESTRUCTURA = (4 * POSTE * POSTE_LARGO + LARGO * S2x8[1]
                 + LARGO * (CANTO_VIGUETA + ESPESOR_TABLERO)) / 144.0
AREA_LATERAL = _A_CUBIERTA_LAT + _A_ALERO_LAT + _A_ESTRUCTURA
FUERZA_LATERAL = QZ * G * CF_LATERAL * AREA_LATERAL
_BRAZO = ((_A_CUBIERTA_LAT * (Z_ARRANQUE + FLECHA / 2)
           + _A_ALERO_LAT * (Z_ARRANQUE - CARA_TOPE / 2)
           + _A_ESTRUCTURA * (Z_VIGA_INF / 2)) / AREA_LATERAL)
MOMENTO_VUELCO = FUERZA_LATERAL * _BRAZO / 12.0          # lb-ft
MOMENTO_ESTABILIZA = RESISTE * (ANCHO / 2) / 12.0        # lb-ft, 0.6D

ANCLAJES = 4
ANCLAJE_CAPACIDAD = 3000.0       # lb, anclaje helicoidal de 30"
# dos anclajes a barlovento, brazo = ancho completo desde la arista de sotavento
MOMENTO_ANCLAJES = 2 * ANCLAJE_CAPACIDAD * (ANCHO / 12.0)

# ===========================================================================
# 7b. Polígonos reales de las piezas de la cercha (para dibujar sin inventar)
#     Coordenadas (u, v): u = medio vano, v = altura sobre el arranque.
# ===========================================================================
def _esp(p, d):
    return (p[0] + d[0], p[1] + d[1])


_OFF_COLA = (-math.sin(ANG_ALTO) * ANCHO_CABIO, -math.cos(ANG_ALTO) * ANCHO_CABIO)


def piezas_cercha():
    """Devuelve {nombre: [(u, v), ...]} con el contorno exacto de cada pieza."""
    d = {
        'cordon':      [(-MEDIA_LUZ, -ANCHO_CABIO), (MEDIA_LUZ, -ANCHO_CABIO),
                        (MEDIA_LUZ, 0.0), (-MEDIA_LUZ, 0.0)],
        'cabio_bajo_d': [P_ALERO_D, P_RODILLA_D, ESQ_RODILLA, ESQ_ASIENTO],
        'cabio_alto_d': [P_RODILLA_D, P_CUMBRERA, ESQ_CUMBRERA, ESQ_RODILLA],
        'tirante':     [(-TIRANTE_CORTA / 2, TIRANTE_V_SUP),
                        (TIRANTE_CORTA / 2, TIRANTE_V_SUP),
                        (TIRANTE_LARGA / 2, TIRANTE_V_INF),
                        (-TIRANTE_LARGA / 2, TIRANTE_V_INF)],
        'cola_d':      [ALERO_TALON, ALERO_PUNTA,
                        _esp(ALERO_PUNTA, _OFF_COLA), _esp(ALERO_TALON, _OFF_COLA)],
    }
    for k in ('cabio_bajo', 'cabio_alto', 'cola'):
        d[k + '_i'] = [(-u, v) for (u, v) in d[k + '_d']]
    return d


def perfil_tejado():
    """Polilínea del canto superior del tejado, de punta de alero a punta."""
    return [(-ALERO_PUNTA[0], ALERO_PUNTA[1]), P_ALERO_I, P_RODILLA_I,
            P_CUMBRERA, P_RODILLA_D, P_ALERO_D, ALERO_PUNTA]


# ===========================================================================
# 8. Utilidades de formato
# ===========================================================================
def frac(x, den=16):
    """Pulgadas decimales -> texto de obra:  27.5532 -> 27 9/16"."""
    neg = x < 0
    x = abs(x)
    whole = int(x + 1e-9)
    n = round((x - whole) * den)
    if n == den:
        whole += 1
        n = 0
    if n == 0:
        s = f'{whole}"'
    else:
        g = math.gcd(n, den)
        s = f'{whole} {n // g}/{den // g}"'
    return ('-' if neg else '') + s


def pies(x, den=16):
    """Pulgadas -> pies y pulgadas:  84 -> 7'-0"."""
    neg = x < 0
    x = abs(x)
    ft = int(x // 12)
    inch = x - ft * 12
    whole = int(inch + 1e-9)
    n = round((inch - whole) * den)
    if n == den:
        whole += 1
        n = 0
    if whole == 12:
        ft += 1
        whole = 0
    core = f"{ft}'-{whole}"
    if n:
        g = math.gcd(n, den)
        core += f' {n // g}/{den // g}'
    return ('-' if neg else '') + core + '"'


# ===========================================================================
# 9. Autocomprobación
# ===========================================================================
def comprobar():
    """Devuelve (ok, [líneas]).  Falla ruidosamente si algo no cierra."""
    fallos, notas = [], []

    def check(cond, msg):
        (notas if cond else fallos).append(('OK  ' if cond else 'FALLO ') + msg)

    check(abs(2 * (CARRERA_BAJA + CARRERA_ALTA) - ANCHO) < 1e-9,
          f'cierre horizontal 2x(carrera baja+alta) = '
          f'{2*(CARRERA_BAJA+CARRERA_ALTA):.9f}" = {ANCHO}"')
    suma_flechas = FLECHA_BAJA + FLECHA_ALTA
    check(abs(suma_flechas - FLECHA) < 1e-9,
          f'cierre vertical subida baja+alta = {suma_flechas:.9f}" = {FLECHA:.9f}"')
    check(abs(math.tan(ANG_BAJO) - (1 + math.sqrt(2))) < 1e-12,
          f'tan 67.5 = {math.tan(ANG_BAJO):.12f} = 1+raiz2')
    check(abs(math.tan(ANG_ALTO) - (math.sqrt(2) - 1)) < 1e-12,
          f'tan 22.5 = {math.tan(ANG_ALTO):.12f} = raiz2-1')

    # cuerdas coherentes con los puntos de trabajo
    lb_sup = math.dist(P_ALERO_D, P_RODILLA_D)
    la_sup = math.dist(P_RODILLA_D, P_CUMBRERA)
    check(abs(lb_sup - CUERDA_BAJA) < 1e-9 and abs(la_sup - CUERDA_ALTA) < 1e-9,
          f'cabio bajo {lb_sup:.6f}" y alto {la_sup:.6f}" coinciden con los '
          f'puntos de trabajo')
    check(abs(ALTURA_TERMINADA - (Z_ARRANQUE + FLECHA + CANTO_CUBIERTA)) < 1e-9,
          f'ALTURA TERMINADA = {Z_ARRANQUE + FLECHA + CANTO_CUBIERTA:.6f}" '
          f'= {pies(ALTURA_TERMINADA)} EXACTOS')
    # canto inferior del cabio bajo, entre el corte de asiento (v=0) y la rodilla
    (ix, iy), (iux, iuy) = _INT_BAJO
    t_asiento = (0 - iy) / iuy
    p_asiento = (ix + iux * t_asiento, 0.0)
    lb_inf = math.dist(p_asiento, ESQ_RODILLA)
    check(abs(lb_inf - CABIO_BAJO_CORTA) < 1e-6,
          f'canto inferior del cabio bajo {lb_inf:.6f}" = punta corta '
          f'{CABIO_BAJO_CORTA:.6f}"')

    # el asiento apoya entero sobre el cordón inferior
    check(p_asiento[0] < P_ALERO_D[0] and p_asiento[0] > 0,
          f'el asiento apoya de u={p_asiento[0]:.4f}" a u={P_ALERO_D[0]:.1f}" '
          f'({CARA_TOPE:.4f}" de cara), dentro del cordón de 72"')

    # el tirante NO choca con el cabio alto
    check(TIRANTE_V_SUP < P_RODILLA_D[1] - 1e-9,
          f'canto sup. del tirante v={TIRANTE_V_SUP:.4f}" queda {P_RODILLA_D[1]-TIRANTE_V_SUP:.4f}" '
          f'bajo el punto de trabajo: NO choca con el cabio alto')
    check(TIRANTE_CORTA < TIRANTE_LARGA,
          f'tirante: canto sup {frac(TIRANTE_CORTA)} < canto inf {frac(TIRANTE_LARGA)}')

    # cotas verticales
    check(abs(Z_CUMBRERA + CANTO_CUBIERTA - 132.0) < 1e-9,
          f'cumbrera estructural {pies(Z_CUMBRERA)} + {frac(CANTO_CUBIERTA, 32)} '
          f'de cubierta = {pies(Z_CUMBRERA + CANTO_CUBIERTA)}')
    check(abs(Z_ARRANQUE - 84.0) < 1e-9, f'arranque del techo a {pies(Z_ARRANQUE)} justos')
    check(Z_ALERO_MIN > 72.0, f'canto bajo del alero a {pies(Z_ALERO_MIN)} (> 6'"'"'-0")')
    check(POSTE_LARGO > 0, f'poste 4x4 = {frac(POSTE_LARGO)}')

    # cubetas
    check(FONDO_CUBETA - Z_PATIN_SUP >= 1.5,
          f'fondo de cubeta a {frac(FONDO_CUBETA)}, patín a {frac(Z_PATIN_SUP)}: '
          f'{frac(FONDO_CUBETA - Z_PATIN_SUP)} de holgura')
    check(len(CENTROS_HUECOS) == N_CUBETAS, f'{len(CENTROS_HUECOS)} huecos')

    peor = min(math.hypot(x2 - x1, y2 - y1) - DIAM_HUECO
               for i, (x1, y1) in enumerate(CENTROS_HUECOS)
               for (x2, y2) in CENTROS_HUECOS[i + 1:])
    check(peor >= 4.0, f'material mínimo entre huecos {frac(peor)}')
    borde = min(min(x, LARGO - x, y, ANCHO - y) for x, y in CENTROS_HUECOS) \
        - DIAM_HUECO / 2 - RIM
    check(borde >= 2.0, f'material del hueco al larguero {frac(borde)}')

    # ningún hueco toca una vigueta
    peor_v = min(abs(cx - vx) - DIAM_HUECO / 2 - RIM / 2
                 for cx, _ in CENTROS_HUECOS for vx in VIGUETAS_X)
    check(peor_v > 0, f'holgura mínima hueco-vigueta {frac(peor_v)}')

    # alcance de un niño desde el borde
    alcance = max(min(y, ANCHO - y, x, LARGO - x) for x, y in CENTROS_HUECOS)
    check(alcance <= 15.0, f'el hueco más interior está a {frac(alcance)} del borde')

    # --- choques de armado ---
    px0 = RETRANQUEO_POSTE
    check(px0 >= RIM, f'el larguero (2x6 de canto) solapa la cara exterior del '
                      f'poste sin atravesarlo: poste retranqueado {frac(px0)}')
    (s0, s1) = PATIN_Y[0]
    check(s0 <= px0 and px0 + POSTE <= s1,
          f'el poste (Y {frac(px0)}..{frac(px0+POSTE)}) apoya entero sobre el '
          f'patín 4x6 (Y {frac(s0)}..{frac(s1)})')
    (v0, v1) = VIGA_Y[0]
    check(abs(v0 - px0) < 1e-9 and abs(VIGA_ANCHO - POSTE) < 1e-9,
          f'la carrera armada mide {frac(VIGA_ANCHO)} = ancho del poste: '
          f'entra el capitel estándar de 4x4')
    check(v1 <= ANCHO / 2, f'el cordón de {frac(CORDON)} apoya {frac(APOYO_CORDON)} '
                           f'en cada carrera y vuela {frac(v0)} por fuera')
    check(all(vx - RIM / 2 > px0 + POSTE and vx + RIM / 2 < LARGO - px0 - POSTE
              for vx in VIGUETAS_X), 'las viguetas quedan libres de los postes')
    check(abs(POS_CERCHAS[2] - LARGO / 2) < 1e-9,
          f'el eje de la cercha central cae en {frac(POS_CERCHAS[2])}: la junta de '
          f'los tableros de 4x8 queda apoyada')
    check(abs(POS_CERCHAS[0] - S2x4[0] / 2) < 1e-9 and
          abs(POS_CERCHAS[-1] - (LARGO - S2x4[0] / 2)) < 1e-9,
          f'las cerchas de hastial van a haces con la testa de la carrera')
    check(min(b - a for a, b, _ in BLOQUEOS) > 12.0,
          f'bloqueo más corto {frac(min(b-a for a,b,_ in BLOQUEOS))}')

    # viento
    check(LEVANTE > RESISTE,
          f'levante {LEVANTE:.0f} lb > 0.6xpeso propio {RESISTE:.0f} lb '
          f'-> LOS ANCLAJES NO SON OPCIONALES')
    check(ANCLAJES * ANCLAJE_CAPACIDAD > 1.5 * LEVANTE,
          f'{ANCLAJES} anclajes x {ANCLAJE_CAPACIDAD:.0f} lb = '
          f'{ANCLAJES*ANCLAJE_CAPACIDAD:.0f} lb > 1.5 x levante '
          f'({1.5*LEVANTE:.0f} lb)')
    check(MOMENTO_VUELCO > MOMENTO_ESTABILIZA,
          f'vuelco {MOMENTO_VUELCO:.0f} lb-ft > estabilizador {MOMENTO_ESTABILIZA:.0f} '
          f'lb-ft: sin anclar VUELCA')
    check(MOMENTO_ANCLAJES + MOMENTO_ESTABILIZA > 1.5 * MOMENTO_VUELCO,
          f'con anclajes {MOMENTO_ANCLAJES + MOMENTO_ESTABILIZA:.0f} lb-ft > '
          f'1.5 x vuelco ({1.5*MOMENTO_VUELCO:.0f} lb-ft)')

    return (not fallos), fallos + notas


if __name__ == '__main__':
    ok, lineas = comprobar()
    print('=' * 78)
    print('BUBBLE BARN — GEOMETRÍA')
    print('=' * 78)
    print(f'Huella {pies(ANCHO)} x {pies(LARGO)}   arranque del techo {pies(ARRANQUE_TECHO)}   '
          f'cumbrera {pies(Z_CUMBRERA)}')
    print()
    print('--- CUBIERTA (lo que importa) ---')
    print(f'  Cabio bajo   {math.degrees(ANG_BAJO):5.1f}° sobre la horizontal  '
          f'(pendiente {PEND_BAJA:.2f} en 12)')
    print(f'  Cabio alto   {math.degrees(ANG_ALTO):5.1f}° sobre la horizontal  '
          f'(pendiente {PEND_ALTA:.2f} en 12)')
    print(f'  INGLETE ÚNICO {INGLETE}°, bisel 0°, tabla plana, en TODOS los cortes '
          f'en ángulo de la cercha')
    print(f'  Cabio BAJO  punta larga {frac(CUERDA_BAJA)} ({CUERDA_BAJA:.4f}")  '
          f'punta corta {frac(CABIO_BAJO_CORTA)} ({CABIO_BAJO_CORTA:.4f}")')
    print(f'  Cabio ALTO  punta larga {frac(CUERDA_ALTA)} ({CUERDA_ALTA:.4f}")  '
          f'punta corta {frac(CABIO_ALTO_CORTA)} ({CABIO_ALTO_CORTA:.4f}")')
    print(f'  Retranqueo por corte {frac(RETRANQUEO)}   cara de tope {frac(CARA_TOPE)}')
    print(f'  Avances {frac(CARRERA_BAJA)} / {frac(CARRERA_ALTA)}   '
          f'subidas {frac(FLECHA_BAJA)} / {frac(FLECHA_ALTA)}')
    print(f'  Flecha estructural {frac(FLECHA)} ({FLECHA:.4f}")   '
          f'canto de cubierta en cumbrera {frac(CANTO_CUBIERTA, 32)}')
    print(f'  ALTURA TERMINADA {pies(Z_CUMBRERA + CANTO_CUBIERTA)} '
          f'({Z_CUMBRERA + CANTO_CUBIERTA:.4f}")')
    print(f'  Tirante de rodilla: canto sup {frac(TIRANTE_CORTA)}, '
          f'canto inf {frac(TIRANTE_LARGA)}, extremos a {INGLETE}°')
    print(f'    (esquina interior de la rodilla a v={frac(ESQ_RODILLA[1])}, '
          f'{frac(P_RODILLA_D[1]-ESQ_RODILLA[1])} bajo el punto de trabajo)')
    print(f'  Cordón inferior {frac(CORDON)} A ESCUADRA (único corte a 0°)')
    print(f'  Cola de alero {frac(ALERO_LARGO)} en los dos cantos, cortes a plomo '
          f'paralelos a {INGLETE}°')
    print(f'    vuela {frac(ALERO_VUELO)}, baja {frac(ALERO_CAIDA)}, '
          f'solapa {frac(ALERO_SOLAPE)} sobre el talón')
    print()
    print('--- PUNTOS DE TRABAJO (canto superior del cabio, v=0 en el arranque) ---')
    for nom, (u, v) in zip(['alero der.', 'rodilla der.', 'cumbrera',
                            'rodilla izq.', 'alero izq.'], P):
        print(f'  {nom:14s} u = {u:+9.4f}  v = {v:8.4f}    '
              f'({frac(abs(u))} , {frac(v)})   Z = {pies(Z_ARRANQUE + v)}')
    print()
    print('--- COTAS VERTICALES SOBRE EL TERRENO ---')
    for nom, z in [('grava compactada (espesor)', GRAVA),
                   ('cara superior del patín 4x6', Z_PATIN_SUP),
                   ('fondo de cubeta colgada', FONDO_CUBETA),
                   ('tablero de la plataforma', Z_PLATAFORMA),
                   ('cara inferior de la carrera', Z_VIGA_INF),
                   ('cara superior de la carrera', Z_VIGA_SUP),
                   ('ARRANQUE DEL TECHO', Z_ARRANQUE),
                   ('rodilla', Z_ARRANQUE + P_RODILLA_D[1]),
                   ('canto bajo de la punta del alero', Z_ALERO_MIN),
                   ('CUMBRERA', Z_CUMBRERA)]:
        print(f'  {nom:34s} {pies(z)}')
    print(f'  {"poste 4x4 (longitud de corte)":34s} {frac(POSTE_LARGO)}')
    print()
    print('--- CONJUNTO ---')
    print(f'  {N_CERCHAS} cerchas a {frac(SEP_CERCHAS)} O.C.; vuelo en hastial '
          f'{frac(VUELO_HASTIAL)} -> cubierta de {frac(LARGO_CUBIERTA)}')
    print(f'  Peso propio estimado {PESO_PROPIO:.0f} lb  +  {PESO_CUBETAS:.0f} lb de cubetas')
    print(f'  Superficie de cubierta {AREA_CUBIERTA:.1f} sq ft   '
          f'hastial {AREA_HASTIAL:.1f} sq ft cada uno')
    print(f'  Jabalcón 45°: punta larga {frac(JABALCON_LARGA)}, '
          f'punta corta {frac(JABALCON_CORTA)}')
    print(f'  Viguetas en X = {VIGUETAS_X};  {len(BLOQUEOS)} bloqueos de '
          f'{", ".join(frac(l) for l in LARGOS_BLOQUEO)}')
    print()
    print('--- VIENTO ---')
    print(f'  qz {QZ:.1f} psf')
    print(f'  LEVANTE   {LEVANTE:.0f} lb   frente a 0.6xD = {RESISTE:.0f} lb')
    print(f'  VUELCO    fuerza lateral {FUERZA_LATERAL:.0f} lb a {_BRAZO/12:.2f} pies '
          f'-> {MOMENTO_VUELCO:.0f} lb-ft')
    print(f'            estabilizador 0.6xD = {MOMENTO_ESTABILIZA:.0f} lb-ft   '
          f'anclajes {MOMENTO_ANCLAJES:.0f} lb-ft')
    print(f'  {ANCLAJES} anclajes helicoidales de {ANCLAJE_CAPACIDAD:.0f} lb '
          f'= {ANCLAJES*ANCLAJE_CAPACIDAD:.0f} lb a levante')
    print()
    print('--- COMPROBACIONES ---')
    for l in lineas:
        print('  ' + l)
    print()
    print('RESULTADO:', 'TODO CIERRA' if ok else '*** HAY FALLOS ***')
