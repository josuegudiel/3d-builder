"""
Motor de dibujo: hojas, cajetín, vistas a escala, cotas, ángulos y notas.
Todo vectorial sobre reportlab.  Las escalas son REALES: si imprimes a
tamaño natural en Letter, el escalímetro da la medida.
"""
import math
from reportlab.pdfgen import canvas as _canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import Color, black, white

PAGINA = (letter[1], letter[0])          # Letter apaisado: 792 x 612 pt

GRIS = Color(0.55, 0.55, 0.55)
GRIS_CLARO = Color(0.80, 0.80, 0.80)
ROJO = Color(0.72, 0.12, 0.12)
AZUL = Color(0.10, 0.25, 0.60)
CREMA = Color(0.96, 0.95, 0.92)
VERDE = Color(0.10, 0.42, 0.25)

MARGEN = 16
CAJETIN_W, CAJETIN_H = 250, 62

PROYECTO = 'BUBBLE BARN — ESTACIÓN DE BURBUJAS'
SUBTITULO = 'Plano rectificado — 6\'-0" x 8\'-0", apoyado sobre el terreno'
FECHA = '08 / 2026'


def escala(pulg_por_pie):
    """'1/2 pulgada = 1 pie' -> puntos de papel por pulgada de modelo."""
    return pulg_por_pie * 6.0


class Hoja:
    def __init__(self, c, numero, titulo, escala_txt='SEGÚN SE INDICA'):
        self.c, self.numero, self.titulo = c, numero, titulo
        self.escala_txt = escala_txt
        self._marco()

    # -- marco y cajetín ----------------------------------------------------
    def _marco(self):
        c, W, H = self.c, *PAGINA
        c.setFillColor(white)
        c.rect(0, 0, W, H, stroke=0, fill=1)
        c.setStrokeColor(black)
        c.setLineWidth(1.4)
        c.rect(MARGEN, MARGEN, W - 2 * MARGEN, H - 2 * MARGEN, stroke=1, fill=0)
        c.setLineWidth(0.5)
        c.rect(MARGEN + 4, MARGEN + 4, W - 2 * MARGEN - 8, H - 2 * MARGEN - 8)

        x0, y0 = W - MARGEN - 4 - CAJETIN_W, MARGEN + 4
        c.setFillColor(CREMA)
        c.rect(x0, y0, CAJETIN_W, CAJETIN_H, stroke=0, fill=1)
        c.setFillColor(black)
        c.setLineWidth(1.0)
        c.rect(x0, y0, CAJETIN_W, CAJETIN_H, stroke=1, fill=0)
        c.setLineWidth(0.4)
        c.line(x0, y0 + CAJETIN_H - 15, x0 + CAJETIN_W, y0 + CAJETIN_H - 15)
        c.line(x0, y0 + 15, x0 + CAJETIN_W, y0 + 15)
        c.line(x0 + CAJETIN_W - 46, y0, x0 + CAJETIN_W - 46, y0 + CAJETIN_H - 15)

        c.setFont('Helvetica-Bold', 7.2)
        c.drawString(x0 + 5, y0 + CAJETIN_H - 11, PROYECTO)
        c.setFont('Helvetica-Bold', 10.5)
        c.drawString(x0 + 5, y0 + 26, self.titulo[:34])
        c.setFont('Helvetica', 6.2)
        c.drawString(x0 + 5, y0 + 18.5, SUBTITULO)
        c.setFont('Helvetica', 6.4)
        c.drawString(x0 + 5, y0 + 5.5, f'ESCALA: {self.escala_txt}')
        c.drawRightString(x0 + CAJETIN_W - 50, y0 + 5.5, FECHA)
        c.setFont('Helvetica-Bold', 20)
        c.drawCentredString(x0 + CAJETIN_W - 23, y0 + 26, self.numero)
        c.setFont('Helvetica', 5.5)
        c.drawCentredString(x0 + CAJETIN_W - 23, y0 + 18, 'HOJA')

    # -- utilidades de hoja -------------------------------------------------
    def texto(self, x, y, s, size=7, font='Helvetica', color=black, al='l'):
        c = self.c
        c.setFillColor(color)
        c.setFont(font, size)
        {'l': c.drawString, 'c': c.drawCentredString,
         'r': c.drawRightString}[al](x, y, s)
        c.setFillColor(black)

    def parrafo(self, x, y, lineas, size=6.6, lead=8.4, font='Helvetica',
                color=black, ancho=None):
        for i, l in enumerate(lineas):
            f = 'Helvetica-Bold' if l.startswith('**') else font
            self.texto(x, y - i * lead, l.replace('**', ''), size, f, color)
        return y - len(lineas) * lead

    def titulo_vista(self, x, y, n, s, esc):
        c = self.c
        c.setLineWidth(0.9)
        c.setStrokeColor(black)
        c.circle(x + 6, y + 3, 6.5, stroke=1, fill=0)
        self.texto(x + 6, y + 0.7, str(n), 7.5, 'Helvetica-Bold', al='c')
        self.texto(x + 17, y + 4, s, 8.6, 'Helvetica-Bold')
        self.texto(x + 17, y - 4.5, f'ESCALA: {esc}', 5.9, 'Helvetica', GRIS)
        w = 17 + max(len(s) * 4.8, len(esc) * 3.4 + 40)
        c.setLineWidth(0.7)
        c.line(x, y - 8.5, x + w, y - 8.5)

    def caja(self, x, y, w, h, relleno=CREMA, borde=black, lw=0.8):
        c = self.c
        if relleno is not None:
            c.setFillColor(relleno)
            c.rect(x, y, w, h, stroke=0, fill=1)
        c.setFillColor(black)
        c.setStrokeColor(borde)
        c.setLineWidth(lw)
        c.rect(x, y, w, h, stroke=1, fill=0)

    def vista(self, s, ox, oy):
        return Vista(self, s, ox, oy)

    def recorte(self, x, y, w, hh):
        """Abre un recorte: nada de lo que se dibuje saldrá de ese rectángulo."""
        c = self.c
        c.saveState()
        p = c.beginPath()
        p.moveTo(x, y)
        p.lineTo(x + w, y)
        p.lineTo(x + w, y + hh)
        p.lineTo(x, y + hh)
        p.close()
        c.clipPath(p, stroke=0, fill=0)

    def fin_recorte(self):
        self.c.restoreState()


class Vista:
    """Sistema de coordenadas del modelo (pulgadas) sobre el papel (puntos)."""

    def __init__(self, hoja, s, ox, oy):
        self.h, self.c, self.s, self.ox, self.oy = hoja, hoja.c, s, ox, oy

    def p(self, x, y):
        return (self.ox + x * self.s, self.oy + y * self.s)

    # -- primitivas ---------------------------------------------------------
    def _pre(self, lw, color, dash=None):
        self.c.setLineWidth(lw)
        self.c.setStrokeColor(color)
        self.c.setDash(dash or [])

    def linea(self, x0, y0, x1, y1, lw=0.7, color=black, dash=None):
        self._pre(lw, color, dash)
        self.c.line(*self.p(x0, y0), *self.p(x1, y1))
        self.c.setDash([])

    def poli(self, pts, cerrado=True, lw=0.7, color=black, relleno=None,
             dash=None):
        c = self.c
        path = c.beginPath()
        path.moveTo(*self.p(*pts[0]))
        for q in pts[1:]:
            path.lineTo(*self.p(*q))
        if cerrado:
            path.close()
        self._pre(lw, color, dash)
        if relleno is not None:
            c.setFillColor(relleno)
        c.drawPath(path, stroke=1, fill=1 if relleno is not None else 0)
        c.setFillColor(black)
        c.setDash([])

    def rect(self, x, y, w, h, lw=0.7, color=black, relleno=None, dash=None):
        self.poli([(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
                  True, lw, color, relleno, dash)

    def circ(self, x, y, r, lw=0.7, color=black, relleno=None, dash=None):
        c = self.c
        self._pre(lw, color, dash)
        if relleno is not None:
            c.setFillColor(relleno)
        c.circle(*self.p(x, y), r * self.s, stroke=1,
                 fill=1 if relleno is not None else 0)
        c.setFillColor(black)
        c.setDash([])

    def arco(self, cx, cy, r, a0, a1, lw=0.5, color=GRIS, dash=None):
        pts = [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
               for a in [a0 + (a1 - a0) * i / 48 for i in range(49)]]
        self.poli(pts, False, lw, color, None, dash)

    def texto(self, x, y, s, size=6, font='Helvetica', color=black, al='l',
              dx=0, dy=0, rot=0):
        px, py = self.p(x, y)
        c = self.c
        c.saveState()
        c.translate(px + dx, py + dy)
        if rot:
            c.rotate(rot)
        c.setFillColor(color)
        c.setFont(font, size)
        {'l': c.drawString, 'c': c.drawCentredString,
         'r': c.drawRightString}[al](0, 0, s)
        c.restoreState()
        c.setFillColor(black)

    # -- cotas --------------------------------------------------------------
    def _tick(self, px, py, ang=45):
        c = self.c
        d = 2.6
        a = math.radians(ang)
        c.setLineWidth(0.8)
        c.setStrokeColor(black)
        c.line(px - d * math.cos(a), py - d * math.sin(a),
               px + d * math.cos(a), py + d * math.sin(a))

    def cota_h(self, x0, x1, y, txt=None, off=14, ext=4, size=5.8, color=black):
        """Cota horizontal.  'off' en puntos por encima (+) o debajo (-) de y."""
        (p0x, p0y), (p1x, _) = self.p(x0, y), self.p(x1, y)
        ly = p0y + off
        c = self.c
        c.setStrokeColor(GRIS)
        c.setLineWidth(0.35)
        s = 1 if off > 0 else -1
        c.line(p0x, p0y + s * 1.5, p0x, ly + s * ext)
        c.line(p1x, p0y + s * 1.5, p1x, ly + s * ext)
        c.setStrokeColor(color)
        c.setLineWidth(0.5)
        c.line(p0x, ly, p1x, ly)
        self._tick(p0x, ly)
        self._tick(p1x, ly)
        t = txt if txt is not None else _pies(abs(x1 - x0))
        c.setFillColor(color)
        c.setFont('Helvetica', size)
        c.drawCentredString((p0x + p1x) / 2, ly + 2.2, t)
        c.setFillColor(black)

    def cota_v(self, y0, y1, x, txt=None, off=14, ext=4, size=5.8, color=black):
        (p0x, p0y), (_, p1y) = self.p(x, y0), self.p(x, y1)
        lx = p0x + off
        c = self.c
        c.setStrokeColor(GRIS)
        c.setLineWidth(0.35)
        s = 1 if off > 0 else -1
        c.line(p0x + s * 1.5, p0y, lx + s * ext, p0y)
        c.line(p0x + s * 1.5, p1y, lx + s * ext, p1y)
        c.setStrokeColor(color)
        c.setLineWidth(0.5)
        c.line(lx, p0y, lx, p1y)
        self._tick(lx, p0y)
        self._tick(lx, p1y)
        t = txt if txt is not None else _pies(abs(y1 - y0))
        c.saveState()
        c.translate(lx - 2.2, (p0y + p1y) / 2)
        c.rotate(90)
        c.setFillColor(color)
        c.setFont('Helvetica', size)
        c.drawCentredString(0, 0, t)
        c.restoreState()
        c.setFillColor(black)

    def cota_al(self, p0, p1, txt, off=13, size=5.8, color=black, lado=1):
        """Cota alineada (paralela al segmento p0-p1)."""
        (ax, ay), (bx, by) = self.p(*p0), self.p(*p1)
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L * lado, dx / L * lado
        A = (ax + nx * off, ay + ny * off)
        B = (bx + nx * off, by + ny * off)
        c = self.c
        c.setStrokeColor(GRIS)
        c.setLineWidth(0.35)
        c.line(ax + nx * 2, ay + ny * 2, ax + nx * (off + 4), ay + ny * (off + 4))
        c.line(bx + nx * 2, by + ny * 2, bx + nx * (off + 4), by + ny * (off + 4))
        c.setStrokeColor(color)
        c.setLineWidth(0.5)
        c.line(*A, *B)
        ang = math.degrees(math.atan2(dy, dx))
        flip = ang > 90 or ang < -90
        c.saveState()
        c.translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)
        c.rotate(ang + (180 if flip else 0))
        c.setFillColor(color)
        c.setFont('Helvetica', size)
        c.drawCentredString(0, 2.0 if not flip else 2.0, txt)
        c.restoreState()
        c.setFillColor(black)
        for q in (A, B):
            self._tick(*q, ang=ang + 45)

    def angulo(self, centro, a0, a1, r, txt, size=6.2, color=ROJO, rtxt=None):
        """Marca de ángulo: arco + texto.  a0/a1 en grados del modelo."""
        self.arco(centro[0], centro[1], r, a0, a1, 0.6, color)
        am = math.radians((a0 + a1) / 2)
        rr = rtxt if rtxt is not None else r * 1.30
        self.texto(centro[0] + rr * math.cos(am), centro[1] + rr * math.sin(am),
                   txt, size, 'Helvetica-Bold', color, al='c', dy=-2)

    def nota(self, pt, dest, txt, size=6, color=black, al='l', font='Helvetica'):
        """Directriz desde 'pt' (modelo) hasta 'dest' (modelo) con texto."""
        c = self.c
        a, b = self.p(*pt), self.p(*dest)
        c.setStrokeColor(color)
        c.setLineWidth(0.45)
        c.line(*a, *b)
        c.setFillColor(color)
        c.circle(a[0], a[1], 1.1, stroke=0, fill=1)
        c.setFont(font, size)
        off = 2.5 if al == 'l' else -2.5
        {'l': c.drawString, 'r': c.drawRightString}[al](b[0] + off, b[1] - 2, txt)
        c.setFillColor(black)

    def globo(self, pt, dest, n, r=6.0):
        c = self.c
        a, b = self.p(*pt), self.p(*dest)
        c.setStrokeColor(black)
        c.setLineWidth(0.45)
        c.line(*a, *b)
        c.circle(a[0], a[1], 1.1, stroke=0, fill=1)
        c.setFillColor(white)
        c.setLineWidth(0.8)
        c.circle(b[0], b[1], r, stroke=1, fill=1)
        c.setFillColor(black)
        c.setFont('Helvetica-Bold', 6.4)
        c.drawCentredString(b[0], b[1] - 2.2, str(n))

    def nivel(self, x, y, txt, ancho=26, al='l'):
        """Marca de cota de nivel (triángulo + línea)."""
        px, py = self.p(x, y)
        c = self.c
        s = 1 if al == 'l' else -1
        c.setStrokeColor(black)
        c.setLineWidth(0.5)
        c.line(px, py, px + s * ancho, py)
        pth = c.beginPath()
        pth.moveTo(px, py)
        pth.lineTo(px - 3, py + 4.6)
        pth.lineTo(px + 3, py + 4.6)
        pth.close()
        c.setFillColor(black)
        c.drawPath(pth, stroke=0, fill=1)
        c.setFont('Helvetica-Bold', 5.8)
        (c.drawString if al == 'l' else c.drawRightString)(
            px + s * (ancho + 2), py - 1.6, txt)

    def rayado(self, pts, paso=3.2, ang=45, lw=0.28, color=GRIS):
        """Rayado de sección dentro de un polígono convexo o simple."""
        pp = [self.p(*q) for q in pts]
        xs = [q[0] for q in pp]
        ys = [q[1] for q in pp]
        c = self.c
        c.saveState()
        path = c.beginPath()
        path.moveTo(*pp[0])
        for q in pp[1:]:
            path.lineTo(*q)
        path.close()
        c.clipPath(path, stroke=0, fill=0)
        c.setStrokeColor(color)
        c.setLineWidth(lw)
        d = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
        t = math.tan(math.radians(ang))
        k = min(xs) - d
        while k < max(xs) + d:
            c.line(k, min(ys) - d, k + d * 2 * t, min(ys) - d + d * 2)
            k += paso / math.cos(math.radians(ang))
        c.restoreState()


# --- formato local (evita importar geometria aquí) -------------------------
def _pies(x, den=16):
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


def nuevo(ruta):
    c = _canvas.Canvas(ruta, pagesize=PAGINA)
    c.setTitle('Bubble Barn — plano rectificado')
    c.setAuthor('WorkPro\'s Construction Services')
    c.setSubject('Estación de burbujas 6\'-0" x 8\'-0"')
    return c
