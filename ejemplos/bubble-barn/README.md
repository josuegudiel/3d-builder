# Bubble Barn — plano rectificado

Estación de burbujas para niños: 6'-0" x 8'-0", apoyada sobre el terreno,
10 cubetas de 5 galones, arranque del techo a 7'-0" y **11'-0" de alto
terminado** (caperuza de cumbrera incluida).

Genera un juego de 9 hojas en PDF con dibujos vectoriales a escala:

```
pip install reportlab
python3 plano.py        # -> Bubble_Barn_Plano_Rectificado.pdf
```

## Ficheros

| Fichero | Qué hace |
| --- | --- |
| `geometria.py` | Fuente única de verdad. Todas las cotas en pulgadas y 28 comprobaciones de cierre. Ejecútalo solo para verlas. |
| `despiece.py` | Lista de corte y lista de compra, con optimizador de corte sobre largos comerciales. |
| `dibujo.py` | Motor de dibujo sobre reportlab: hojas, cajetín, vistas a escala, cotas, ángulos y recortes. |
| `plano.py` | Las nueve hojas. Aborta si la geometría no cierra. |

Ninguna cota del plano está escrita a mano: todas salen de `geometria.py`.
Si una comprobación falla, `plano.py` no genera el PDF.

## La cubierta

Gambrel de 67.5° / 22.5°. Los ángulos no se eligen: exigir el mismo reglaje
de sierra en el asiento (90-tB), en la rodilla ((tB-tA)/2) y en la cumbrera
(tA) da tB + tA = 90 y tB = 3 tA, cuya única solución es 67.5° y 22.5°. Eso
**no depende de la flecha**, así que sobrevive a cualquier altura.

Consecuencias prácticas:

- **Un solo reglaje**: inglete 22.5°, bisel 0°, tabla plana, en todos los
  cortes en ángulo de la cercha y también en la cola del alero. El único
  corte a escuadra es el cordón inferior de 72".
- **Dos cabios**: bajo 41 3/8" y alto 21 13/16", 14 unidades de cada uno.
  (Con flecha = luz/2 los cuatro salían iguales; a 11 pies ya no.)
- **Cierre exacto**: los avances suman 36.000000" y las subidas, la flecha.
- **La flecha sale de la altura terminada, no al revés**:
  `flecha = 132" − 84" − canto de cubierta en la cumbrera`, con
  `canto = (tablero + fieltro + teja)/cos 22.5° + caperuza`. Cambiar de teja
  cambia la flecha: la hoja A-5 lleva la tabla para cuatro paquetes de
  cubierta y la sensibilidad por cada 1/16" de espesor.
