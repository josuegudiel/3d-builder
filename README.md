# Form3D

Modelador 3D de modelado directo estilo SketchUp, que funciona entero en el
navegador. Dibujas formas planas, las empujas para convertirlas en volúmenes y
escribes las medidas exactas en cualquier momento.

No necesita instalación ni servidor: es una aplicación estática.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/ listo para publicar
npm test         # 352 pruebas del núcleo geométrico
```

---

## Cómo se usa

1. Pulsa **R** y dibuja un rectángulo sobre el suelo.
2. Antes de soltar, escribe `4000;3000` y pulsa **Intro**: obtienes 4 × 3 metros
   exactos.
3. Pulsa **P** (Empujar/Tirar), haz clic en la cara y mueve el ratón hacia
   arriba. Escribe `2500` e **Intro**: una caja de 4 × 3 × 2,5 m.
4. Con **L** dibuja líneas sobre las caras: cada contorno cerrado se convierte
   en una cara nueva que también puedes empujar.
5. **D** acota, **T** mide, **Ctrl+G** agrupa y el doble clic entra en el grupo.

El cuadro de medidas (abajo a la derecha) acepta:

| Se escribe | Significa |
|---|---|
| `1200` | 1200 en la unidad activa |
| `1.2m` `120cm` `0.0012km` | con unidad explícita |
| `1,2m` | coma decimal |
| `48"` `4'` `5' 6"` `5'6` `6 1/2"` | sistema imperial y notación arquitectónica |
| `4000;3000` | ancho y alto de un rectángulo |
| `1000;500;250` | desplazamiento en X, Y, Z al mover |
| `24s` | número de lados de un círculo o polígono |
| `45` | ángulo en grados al rotar |

---

## Herramientas

**Dibujo** — Línea, Rectángulo, Círculo, Polígono, Arco (por comba y por tres
puntos).

**Modificación** — Empujar/Tirar, Mover, Rotar, Escalar, Equidistancia, Sígueme.

**Utilidades** — Borrar, Pintar, Metro, Acotar, Transportador.

**Navegación** — Orbitar, Desplazar, Zoom. La rueda hace zoom hacia el cursor y
el botón central orbita desde cualquier herramienta (con Mayús, desplaza).

Los atajos completos están en **Ayuda ▸ Atajos de teclado** o pulsando `?`.

### Inferencia

Como en SketchUp, el cursor se engancha a lo que hay bajo él y lo anuncia:
punto final, punto medio, sobre la arista, sobre la cara, centro y origen.
Desde el último punto marcado se infieren además las direcciones de los tres
ejes; las flechas **→ ↑ ←** bloquean el eje rojo, azul y verde, **↓** libera el
bloqueo y **Alt** desactiva el enganche mientras se mantiene pulsada.

---

## Cómo está hecho por dentro

El núcleo no es una malla de triángulos: es un modelo topológico de vértices,
aristas y caras, igual que el de SketchUp. Todo lo demás se deriva de ahí.

### Unidades

El modelo guarda **metros** en `Float64`. Las coordenadas típicas quedan entre
1e-3 y 1e3, lo que conserva precisión tanto en el kernel como en los búferes de
la GPU. La conversión a milímetros, pulgadas o pies ocurre sólo al leer y
escribir texto (`src/core/units.ts`). La tolerancia es de 1 µm.

### Descubrimiento de caras

Cuando se añade una arista hay que averiguar qué caras nuevas aparecen. El
proceso tiene dos partes:

**1. Inserción con partición** (`topology/insert.ts`). El segmento nuevo se
cruza con todas las aristas existentes; cada corte parte la arista afectada
actualizando en el sitio los bucles de las caras que la usaban, de modo que
ninguna cara se pierde. Después se recogen todos los vértices que caen sobre el
segmento y se encadenan. Repasar una arista existente no la duplica.

**2. Subdivisión planar** (`topology/arrangement.ts`). Para cada plano afectado
se toman todas las aristas contenidas en él, se proyectan a 2D y se recorren
sus semiaristas con la regla clásica: *la siguiente semiarista es la anterior,
en sentido antihorario, a la gemela en el vértice destino*. Eso produce un ciclo
por cada cara del arreglo. Los ciclos de área positiva son caras; los de área
negativa son el contorno exterior de una componente conexa y se convierten en
agujero de la cara de menor área que los contiene y pertenece a otra
componente.

De ahí salen gratis los comportamientos que uno espera: dibujar un rectángulo
dentro de otro crea dos caras (el marco con un hueco y el interior), a tres
niveles de anidamiento también, borrar una arista divisoria funde las dos caras,
y una arista suelta dentro de una cara no la parte.

La reconstrucción (`topology/rebuild.ts`) compara las regiones halladas con las
caras que ya existían: si la firma coincide, la cara **se conserva** con su
identificador, su material y su selección; si es nueva, hereda material y
orientación de la cara antigua que la contenía. Borrar una cara dejando sus
aristas la marca como suprimida para que no reaparezca —y volver a trazar una de
sus aristas la resucita, igual que en SketchUp.

### Empujar/Tirar

Tiene los dos modos del original:

- **Deslizar**, cuando cada arista del contorno tiene exactamente una cara
  vecina y todas contienen la dirección de empuje. Es el caso de la tapa de un
  prisma: los vértices se mueven y los laterales se estiran. Si el empuje lleva
  la cara hasta el fondo, los vértices coincidentes se sueldan y el volumen
  colapsa correctamente en una cara plana.
- **Extruir**, en cualquier otro caso: se crean las aristas verticales y el
  contorno desplazado, y la subdivisión planar descubre los laterales y la tapa.
  Si la cara estaba encerrada entre dos volúmenes, se elimina. Los agujeros
  atraviesan la pieza en lugar de quedar tapados.

Después, `topology/orient.ts` propaga una orientación coherente por las aristas
compartidas y, si la componente resulta ser una cáscara cerrada, comprueba el
volumen con signo para que las caras frontales miren hacia fuera.

### Transformaciones

Mover, rotar y escalar estiran la geometría conectada. Si una cara deja de ser
plana se triangula añadiendo diagonales suaves, y los vértices que quedan
superpuestos se sueldan. Todo se reconstruye después por planos.

### Deshacer

Por instantáneas completas del modelo serializado. Con una topología derivada es
la única estrategia en la que una operación inversa mal escrita no puede dejar
el modelo incoherente, y el coste es despreciable para modelos de trabajo.

### Selección y renderizado

La escena de three.js se reconstruye entera en cada cambio y, en la misma
pasada, se genera la caché que usa el selector. La selección funciona por rayo
para las caras y por distancia en píxeles para aristas y vértices, con el orden
de prioridad de SketchUp y descartando lo que queda oculto tras una cara.

---

## Mapa del código

```
src/core/math/        Vec2/Vec3, Mat4, planos, intersecciones, polígonos
src/core/units.ts     parseo y formato métrico e imperial
src/core/model/       Geometry (con validate()), Model, definiciones, cotas y guías
src/core/topology/    arrangement, insert, rebuild, weld, orient, repair,
                      triangulate, keys, loops
src/core/ops/         draw, erase, pushpull, transform, offset, followme,
                      primitives, solids, group
src/core/io/          serialize (JSON), obj, stl
src/core/history.ts   deshacer/rehacer
src/render/           cámara orbital Z-arriba, escena, superposición, viewport
src/pick/             selección por rayo y motor de inferencia
src/app/              editor (núcleo) y guardado automático
src/tools/            las 21 herramientas
src/ui/               interfaz completa
```

`Geometry.validate()` comprueba todos los invariantes de la topología
(adyacencias coherentes, bucles bien encadenados, vértices en el plano de su
cara) y se usa en las pruebas después de cada operación.

---

## Pruebas

```bash
npm test                                        # 352 pruebas del núcleo
node tests/e2e/smoke.mjs http://localhost:5173/ # prueba en Chromium
```

Las pruebas del núcleo cubren la formación de caras, agujeros anidados,
empujar/tirar en todos sus modos, robustez numérica de milímetros a kilómetros,
unidades y entrada/salida. La prueba de navegador conduce la aplicación real:
dibuja con medidas exactas, extruye, deshace, divide caras, agrupa y exporta,
verificando el volumen del sólido y los invariantes tras cada paso.

---

## Límites conocidos

- Empujar una cara **a través** de un sólido no perfora un agujero: se permite
  la operación, pero no hay booleanas todavía.
- No hay texturas ni coordenadas UV; los materiales son colores con opacidad.
- Sígueme funciona con el recorrido seleccionado de antemano.
- El guardado automático usa el almacenamiento local del navegador; para
  conservar el trabajo de verdad, usa **Archivo ▸ Guardar**.
- Dos cáscaras cerradas independientes (una caja dentro de otra) se orientan
  cada una hacia fuera, como dos sólidos separados. No se interpretan como un
  sólido con cavidad, igual que en SketchUp.
- En geometría no-manifold —dos volúmenes que comparten una cara— la
  orientación no se propaga a través de las aristas compartidas por tres caras.
  El panel de información sólo muestra el volumen cuando la selección forma un
  sólido cerrado de verdad, así que nunca da una cifra engañosa.
- El coste de reconstruir un plano crece con el número de aristas que contiene.
  Con unos cientos de rectángulos coplanares cada operación cuesta pocos
  milisegundos; un plano con muchos miles de aristas se nota.
