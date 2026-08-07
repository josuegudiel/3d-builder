"""
Bubble Barn — lista de corte y lista de compra.

Todas las cantidades salen de geometria.py.  La lista de compra se calcula
con un optimizador de corte real (first-fit decreasing sobre longitudes
comerciales), no a ojo.
"""
import math
from geometria import *          # noqa: F401,F403

KERF = 0.125                     # 1/8" de vía de sierra

# ===========================================================================
# Lista de corte
# ---------------------------------------------------------------------------
# marca, cantidad, material, largo (pulg), avance al anidar, ángulos, destino
# 'avance' = longitud de tabla que consume cada pieza cuando se anidan a
# contrapelo (para las piezas trapeciales es menor que el largo).
# ===========================================================================
Pieza = lambda marca, qty, mat, largo, ang, donde, avance=None, nota='': dict(
    marca=marca, qty=qty, mat=mat, largo=largo,
    avance=largo if avance is None else avance, ang=ang, donde=donde, nota=nota)

CIMENTACION = [
    Pieza('C1', 2, '4x6 PT', LARGO, 'escuadra',
          'Patines (skids) bajo las líneas de postes'),
]

ESTRUCTURA = [
    Pieza('P1', 4, '4x4 PT', POSTE_LARGO, 'escuadra',
          'Postes de esquina'),
    Pieza('P2', 2, '4x4 PT', Z_VIGUETA_INF - Z_PATIN_SUP, 'escuadra',
          'Tacos de apoyo central de la plataforma, sobre el patín'),
    Pieza('V1', 4, '2x8 PT', LARGO, 'escuadra',
          'Carrera doble, lados de 8\'-0" (2 tablas por lado)'),
    Pieza('V2', 2, '2x8 PT', ANCHO - 2 * (RETRANQUEO_POSTE + VIGA_ANCHO), 'escuadra',
          'Carrera de extremo, lados de 6\'-0"'),
    Pieza('R1', 8, '2x4 PT', JABALCON_LARGA, '45° los dos extremos',
          'Jabalcones: 4 esquinas x 2 direcciones',
          nota=f'punta corta {frac(JABALCON_CORTA)}'),
]

PLATAFORMA = [
    Pieza('F1', 2, '2x6 PT', LARGO, 'escuadra',
          'Largueros perimetrales, lados largos'),
    Pieza('F2', 2, '2x6 PT', ANCHO - 2 * RIM, 'escuadra',
          'Largueros perimetrales, lados cortos'),
    Pieza('F3', 3, '2x6 PT', ANCHO - 2 * RIM, 'escuadra',
          f'Viguetas en X = {", ".join(frac(v) for v in VIGUETAS_X)}'),
]
for _l in LARGOS_BLOQUEO:
    _n = sum(1 for a, b, _ in BLOQUEOS if abs((b - a) - _l) < 1e-6)
    PLATAFORMA.append(Pieza('F4' if _l > 22 else 'F5', _n, '2x6 PT', _l,
                            'escuadra', 'Bloqueo tangente a los huecos'))

# --- Cerchas ---------------------------------------------------------------
N_CABIOS = 4 * N_CERCHAS + 8          # 20 en cerchas + 8 en escaleras de vuelo
N_COLAS = 2 * N_CERCHAS + 4           # 10 en cerchas + 4 en escaleras de vuelo
AVANCE_CABIO = (CABIO_PUNTA_LARGA + CABIO_PUNTA_CORTA) / 2   # anidado a contrapelo

CERCHAS = [
    Pieza('T1', N_CABIOS, '2x4', CABIO_PUNTA_LARGA,
          f'{INGLETE}° los dos extremos',
          'CABIO — la misma pieza para los 4 faldones; ingletes CONVERGIENDO al canto inferior',
          avance=AVANCE_CABIO,
          nota=f'punta corta {frac(CABIO_PUNTA_CORTA)}'),
    Pieza('T2', N_CERCHAS, '2x4', TIRANTE_LARGA,
          f'{INGLETE}° los dos extremos',
          'Tirante de rodilla; ingletes CONVERGIENDO al canto superior',
          nota=f'canto superior {frac(TIRANTE_CORTA)}'),
    Pieza('T3', N_CERCHAS, '2x4', CORDON, 'ESCUADRA (0°)',
          'Cordón inferior — único corte a escuadra de la cercha'),
    Pieza('T4', N_COLAS, '2x4', ALERO_LARGO,
          f'{INGLETE}° paralelos',
          'Cola de alero acampanado (paralelogramo) — hace de cartela del talón',
          avance=ALERO_LARGO),
    Pieza('T5', 16, '2x4', VUELO_HASTIAL, 'escuadra',
          'Travesaños de la escalera de vuelo en los hastiales'),
]

TABLEROS = [
    Pieza('G1', 2 * N_CERCHAS, '1/2" contrachapado', 0, '—',
          'Cartela de cumbrera 24" x 9", las dos caras'),
    Pieza('G2', 4 * N_CERCHAS, '1/2" contrachapado', 0, '—',
          'Cartela de rodilla 14" x 14", las dos caras'),
    Pieza('S1', 4, '1/2" contrachapado', 96, '—',
          f'Entablado de faldón, bandas de {frac(CUERDA)} de ancho'),
    Pieza('S2', 4, '1/2" contrachapado', 12, '—',
          f'Remate de faldón hasta {frac(LARGO_CUBIERTA)}'),
    Pieza('S3', 2, '1/2" contrachapado', 96, '—',
          'Entablado de la falda del alero, bandas de 13"'),
    Pieza('S4', 2, '1/2" contrachapado', 12, '—',
          'Remate de la falda del alero'),
    Pieza('F6', 2, '3/4" contrachapado PT', 0, '—',
          'Tablero de la plataforma, hoja de 4x8'),
    Pieza('S5', 2, 'LP SmartSide / T1-11', 0, '—',
          'Hastial recortado al perfil gambrel'),
]

CARPINTERIA = [
    Pieza('TR1', 8, '1x4', 30.0, f'ingletes a {INGLETE}°',
          'Perfil gambrel del hastial, tramos de cabio (4 por hastial)'),
    Pieza('TR1b', 4, '1x4', 16.0, f'ingletes a {INGLETE}°',
          'Perfil gambrel del hastial, tramos de alero (2 por hastial)'),
    Pieza('TR2', 2, '1x4', LARGO_CUBIERTA, 'escuadra', 'Fascia del alero'),
    Pieza('TR3', 4, '1x6', LARGO_CUBIERTA, 'escuadra',
          'Sofito bajo la falda del alero (2 filas por lado)'),
]

SECCIONES = [('CIMENTACIÓN', CIMENTACION), ('POSTES Y CARRERAS', ESTRUCTURA),
             ('PLATAFORMA DE CUBETAS', PLATAFORMA), ('CERCHAS', CERCHAS),
             ('TABLEROS Y CUBIERTA', TABLEROS), ('CARPINTERÍA EXTERIOR', CARPINTERIA)]


# ===========================================================================
# Optimizador de corte
# ===========================================================================
STOCK = {                       # longitudes comerciales en pies
    '4x6 PT': (8, 10, 12, 16),
    '4x4 PT': (8, 10, 12),
    '2x8 PT': (8, 10, 12, 16),
    '2x6 PT': (8, 10, 12, 16),
    '2x4 PT': (8, 10, 12, 16),
    '2x4':    (8, 10, 12, 16),
    '1x4':    (8, 10, 12),
    '1x6':    (8, 10, 12),
}


def _llenar(pend, capacidad):
    """Mete piezas (mayor primero) en una tabla de 'capacidad' pulgadas.
    Devuelve (índices usados, pulgadas ocupadas).  El corte de la última
    pieza de cada tabla no consume vía de sierra."""
    usados, ocupado = [], 0.0
    for i, (largo, avance) in enumerate(pend):
        # la PRIMERA pieza de la tabla cuesta su largo real; las siguientes,
        # sólo el avance del anidado (el inglete se comparte).
        coste = (largo if not usados else avance) + KERF
        if ocupado + coste <= capacidad + KERF + 1e-9:
            usados.append(i)
            ocupado += coste
    return usados, ocupado


def _mezclado(material, pend0):
    pend = list(pend0)
    tablas = {}
    while pend:
        mejor = None
        for ft in STOCK.get(material, (8, 10, 12, 16)):
            usados, ocupado = _llenar(pend, ft * 12.0)
            if not usados:
                continue
            # rendimiento = pulgadas útiles / pulgadas compradas
            rend = ocupado / (ft * 12.0)
            if mejor is None or rend > mejor[0] + 1e-9:
                mejor = (rend, ft, usados)
        if mejor is None:
            raise ValueError(f'{material}: pieza más larga que cualquier tabla')
        _, ft, usados = mejor
        tablas[ft] = tablas.get(ft, 0) + 1
        for i in reversed(usados):
            pend.pop(i)

    return tablas


def _un_solo_largo(material, pend0, ft):
    pend = list(pend0)
    n = 0
    while pend:
        usados, _ = _llenar(pend, ft * 12.0)
        if not usados:
            return None
        n += 1
        for i in reversed(usados):
            pend.pop(i)
    return {ft: n}


def optimizar(material):
    """Corte real.  Prefiere UN SOLO largo comercial (más fácil de comprar);
    sólo mezcla si mezclar ahorra más de un 8% de madera."""
    pend = []
    for _, piezas in SECCIONES:
        for p in piezas:
            if p['mat'] == material:
                pend += [(p['largo'], p['avance'])] * p['qty']
    if not pend:
        return None
    pend.sort(key=lambda t: -t[0])
    cortes = sum(l for l, _ in pend)

    mix = _mezclado(material, pend)
    uni = None
    for ft in STOCK.get(material, (8, 10, 12, 16)):
        r = _un_solo_largo(material, pend, ft)
        if r and (uni is None or sum(k * v for k, v in r.items())
                  < sum(k * v for k, v in uni.items())):
            uni = r
    pies_mix = sum(ft * n for ft, n in mix.items())
    pies_uni = sum(ft * n for ft, n in uni.items()) if uni else 1e9
    tablas = mix if pies_uni > pies_mix * 1.08 else uni
    total = sum(ft * n for ft, n in tablas.items())
    return dict(material=material, tablas=dict(sorted(tablas.items())),
                pies_totales=total, pies_cortados=cortes / 12.0,
                merma=1 - (cortes / 12.0) / total)


def compra_madera():
    mats = []
    for sec, piezas in SECCIONES:
        for p in piezas:
            if p['mat'] in STOCK and p['mat'] not in mats:
                mats.append(p['mat'])
    return [optimizar(m) for m in mats]


# ===========================================================================
# Tableros: superficie y hojas
# ===========================================================================
HOJA = 48 * 96 / 144.0            # 32 sq ft


def compra_tableros():
    ply_gussets = (2 * N_CERCHAS * 24 * 9 + 4 * N_CERCHAS * 14 * 14) / 144.0
    ply_cubierta = AREA_CUBIERTA
    # el entablado sale en bandas de 27 9/16" y 13": de cada hoja de 48"
    # se saca una banda de 27 9/16" y otra de 20 7/16"
    hojas_cubierta = 6
    return [
        dict(mat='1/2" contrachapado exterior', hojas=hojas_cubierta,
             detalle=f'cubierta {ply_cubierta:.1f} sq ft + cartelas '
                     f'{ply_gussets:.1f} sq ft; ripar cada hoja en '
                     f'{frac(CUERDA)} + 20 7/16"'),
        dict(mat='3/4" contrachapado PT', hojas=2,
             detalle=f'tablero de la plataforma {LARGO*ANCHO/144:.0f} sq ft'),
        dict(mat='LP SmartSide / T1-11', hojas=2,
             detalle=f'2 hastiales de {AREA_HASTIAL:.1f} sq ft, '
                     f'{frac(ANCHO)} de ancho x {frac(FLECHA)} de alto'),
    ]


HERRAJES = [
    (4, 'Anclaje helicoidal al terreno, 30", ~3000 lb, con fleje y tensor',
     'NO OPCIONAL: sustituye a los pilares enterrados'),
    (4, 'Base de poste galvanizada para 4x4, al patín', 'con tirafondos 1/4" x 3"'),
    (4, 'Capitel (post cap) galvanizado para 4x4', 'poste-carrera'),
    (10, 'Herraje antihuracán (hurricane tie)', '2 por cercha, cercha-carrera'),
    (40, 'Tornillo estructural 1/4" x 4"', 'jabalcones, capiteles y bases'),
    (1, 'Caja de tornillos exteriores de 3" (5 lb)', 'estructura'),
    (1, 'Caja de tornillos exteriores de 1 5/8" (5 lb)', 'cartelas y tableros'),
    (2, 'Caja de clavos de tejar galvanizados 1 1/4"', 'cubierta'),
    (1, 'Rollo de fieltro asfáltico 15 lb (400 sq ft)', 'bajo teja'),
    (5, 'Fardo de teja asfáltica arquitectónica',
     f'{AREA_CUBIERTA:.0f} sq ft = {AREA_CUBIERTA/100:.2f} cuadras; 5 fardos cubren 1.67'),
    (1, 'Rollo de banda de arranque (starter strip)', 'alero y sobre cada quiebro de rodilla'),
    (1, 'Yarda cúbica de grava #57', f'lecho de {pies(LARGO+8)} x {pies(ANCHO+8)} x {frac(GRAVA)}'),
    (1, 'Geotextil 9\' x 7\'', 'bajo la grava'),
    (1, 'Galón de sellador exterior transparente, bajo en COV', 'apto para contacto infantil'),
    (10, 'Cubeta de 5 galones con tapa', 'POR EL CLIENTE'),
]


if __name__ == '__main__':
    print('=' * 78)
    print('LISTA DE CORTE')
    print('=' * 78)
    for sec, piezas in SECCIONES:
        print(f'\n--- {sec} ---')
        for p in piezas:
            largo = frac(p['largo']) if p['largo'] else '(ver hoja)'
            print(f"  {p['marca']:4s} {p['qty']:3d} x {p['mat']:24s} {largo:>12s}  "
                  f"{p['ang']}")
            print(f"       {p['donde']}" + (f"   [{p['nota']}]" if p['nota'] else ''))

    print('\n' + '=' * 78)
    print('LISTA DE COMPRA — MADERA EN LARGOS COMERCIALES')
    print('=' * 78)
    for c in compra_madera():
        if not c:
            continue
        mix = ' + '.join(f"{n} de {ft} ft" for ft, n in c['tablas'].items())
        print(f"  {c['material']:10s} {mix:28s} = {c['pies_totales']:3.0f} pies lineales   "
              f"(cortes {c['pies_cortados']:.1f} ft, merma {c['merma']*100:.0f}%)")

    print('\n--- TABLEROS ---')
    for t in compra_tableros():
        print(f"  {t['mat']:28s} {t['hojas']} hojas de 4x8   {t['detalle']}")

    print('\n--- HERRAJES Y VARIOS ---')
    for q, d, n in HERRAJES:
        print(f'  {q:3d}  {d:58s} {n}')
