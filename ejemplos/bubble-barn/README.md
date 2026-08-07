# Bubble Barn — plano rectificado

Estación de burbujas para niños: 6'-0" x 8'-0", apoyada sobre el terreno,
10 cubetas de 5 galones, arranque del techo a 7'-0" y cumbrera a 10'-0".

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

Gambrel con los cinco puntos de trabajo sobre una semicircunferencia de
radio = luz/2. Los ángulos no se eligen: exigir el mismo reglaje de sierra
en el asiento (90-tB), en la rodilla ((tB-tA)/2) y en la cumbrera (tA) da
tB + tA = 90 y tB = 3 tA, cuya única solución es 67.5° y 22.5°.

Consecuencias prácticas:

- **Un solo reglaje**: inglete 22.5°, bisel 0°, tabla plana, en todos los
  cortes en ángulo de la cercha y también en la cola del alero. El único
  corte a escuadra es el cordón inferior de 72".
- **Un solo cabio**: los cuatro faldones usan la misma pieza, 27 9/16" de
  punta larga y 24 5/8" de punta corta. 28 piezas idénticas.
- **Cierre exacto**: 2 x (carrera baja + alta) = 72.000000" y la suma de
  flechas = 36.000000". Arranque a 7'-0" y cumbrera a 10'-0", los dos justos.
- **Replanteo con dos arcos**: los puntos de trabajo caen en el arco de 36"
  y todas las esquinas interiores de los ingletes en el de 32 7/32".
