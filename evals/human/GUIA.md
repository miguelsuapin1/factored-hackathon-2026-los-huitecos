# Guía para escribir mensajes de prueba (paso 16)

Gracias por ayudar. Esta guía explica qué escribir, cómo y por qué. Lee todo una vez antes de empezar; toma unos 10 minutos.

## ¿Para qué sirve?

Construimos un asistente de atención al cliente para un banco ficticio, "GT Bank". Lo primero que hace el asistente es entender **qué quiere el cliente** en su primer mensaje: ¿no reconoce un cargo?, ¿le cobraron de más?, ¿quiere saber su saldo?, ¿quiere hablar con una persona?

Hasta ahora, todos los mensajes con los que probamos el asistente los escribimos nosotros mismos o una inteligencia artificial. Eso hace que los resultados se vean mejores de lo que son: el sistema "conoce" nuestra forma de escribir. **Tus mensajes son la prueba honesta**: muestran cómo escribe la gente de verdad. Por eso no importa que tengan errores de ortografía, abreviaturas o emojis. Al contrario, ayudan.

## Qué tienes que hacer

1. **Imagina que le escribes al chat de tu banco.** Cada mensaje es el **primer mensaje** de una conversación, tal como lo escribirías en el celular.
2. **Escribe en español** (o en portugués, si lo hablas como lengua materna: esos mensajes son los más valiosos).
3. **Escribe como tú escribes.** Formal, informal, con prisa, enojado, con faltas, con modismos de tu país, corto o largo. Todo vale.
4. **Escribe varios mensajes distintos**, idealmente entre 5 y 15 por persona.
5. **Anota cada mensaje** en la hoja de entrega (ver más abajo).

## Dos formas de escribir

### Forma 1: "fresco" (la que más nos sirve)

Lee **solo la situación** de una tarjeta (la lista de tarjetas está más abajo) y escribe lo que tú le dirías al banco en esa situación, **con tus propias palabras**. No mires ningún ejemplo antes.

También puedes inventar tu propia situación o, mejor aún, usar algo que de verdad te haya pasado con un banco.

### Forma 2: "parafraseo" (solo si te trabas)

Si no se te ocurre nada, puedes leer el **ejemplo** de una tarjeta y reescribirlo a tu manera. Pero:

- **Cambia las palabras y la estructura**, no solo el orden o una palabra. "Me cobraron dos veces" → "me pasaron la tarjeta doble en el súper" sí; "Dos veces me cobraron" no.
- Anota **qué ejemplo usaste** (por ejemplo, `EX06`).

Los parafraseos heredan parte de la forma de escribir del ejemplo, así que los medimos por separado. **Escribe al menos la mitad de tus mensajes en forma fresca.**

## Qué quiere el cliente: las 7 categorías

No necesitas memorizarlas: si no estás seguro de la categoría de tu mensaje, déjala vacía y alguien del equipo la pondrá. Pero te ayudan a escribir sobre todos los temas.

| Categoría | El cliente… | Ejemplo de situación |
|---|---|---|
| `unrecognized_charge` (cargo no reconocido) | ve un cargo, retiro o transferencia que **no hizo o no reconoce para nada** | una compra en una tienda que no conoce, un retiro de cajero que no hizo, una tarjeta clonada o perdida **con** cargos |
| `wrongful_fee` (cobro incorrecto) | **sí reconoce** el cargo o la comisión, pero dice que **está mal** | le cobraron dos veces, el monto está mal, una comisión que no corresponde, le siguen cobrando algo que canceló |
| `transaction_status` (estado de una operación) | pregunta **qué pasó** con una operación o un reclamo | una compra rechazada, algo "pendiente", una transferencia que no llega, "¿cómo va mi reclamo?" |
| `balance_check` (saldo) | pregunta saldos, deudas, límites o movimientos, **sin queja** | "¿cuánto tengo?", "¿cuánto debo en la tarjeta?" |
| `move_money` (mover dinero) | pide que el asistente **mueva dinero**: devolver, transferir, pagar | "devuélvanme mi dinero", "pasa 200 a mi otra cuenta" |
| `human_agent` (hablar con una persona) | pide una **persona**: asesor, supervisor, teléfono, llamada | "quiero hablar con alguien" |
| `out_of_scope` (otro tema) | cualquier otra cosa | préstamos, seguros, bloquear la tarjeta (sin cargos raros), horarios de sucursal, saludos, "gracias" |

**Reglas para decidir entre dos categorías:**

1. **No conoce el cargo → `unrecognized_charge`. Lo conoce pero dice que está mal → `wrongful_fee`.** Un cobro duplicado es `wrongful_fee`: una de las dos compras sí la hizo.
2. **Productos del banco que no pidió** (un seguro, alertas por SMS, la anualidad) son `wrongful_fee`: sabe que el cobro viene del banco.
3. **Tarjeta perdida con cargos** → `unrecognized_charge`. **Tarjeta perdida sin cargos** ("quiero bloquearla") → `out_of_scope`.
4. **`move_money` solo cuando lo principal es mover el dinero.** Si además describe un problema con un cargo, el mensaje es ambiguo (ver abajo).
5. **Saludos y agradecimientos** → `out_of_scope`.

### Mensajes ambiguos (queremos unos cuantos)

Algunos mensajes no dejan claro qué quiere el cliente, y una persona atenta **preguntaría** antes de actuar. Por ejemplo: "me cobraron algo raro" (¿no lo reconoce, o el monto está mal?). Esos mensajes son muy útiles: sirven para comprobar que el asistente pregunta en vez de adivinar.

**Más o menos 1 de cada 5 mensajes debería ser ambiguo.** En la hoja, marca que es ambiguo y escribe las dos categorías posibles.

## Lo que más nos falta

- **Retiros de cajero que el cliente no hizo.** Es lo que peor entiende el asistente hoy.
- **Mensajes muy cortos**, de dos o tres palabras ("saldo", "cobro doble", "no fui yo").
- **Portugués escrito por brasileños**, si conoces a alguien.

## Lo que NO debes hacer

- **No uses datos personales reales:** ni números de tarjeta, ni cédulas o DNI, ni nombres, ni teléfonos reales. Inventados está bien.
- **No copies** un ejemplo tal cual: el sistema rechaza las copias exactas.
- **No mires** los archivos de entrenamiento del proyecto (`data/phrases/`) ni las conversaciones de prueba antes de escribir.
- **No cambies un mensaje después** de que lo hayamos evaluado. Si algo estaba mal, se escribe un mensaje nuevo.
- **No uses ChatGPT ni otra IA** para escribirlos. Toda la gracia es que sean de personas.

## Cómo entregar tus mensajes

Si no trabajas con el repositorio, mándale tus mensajes a Luis Pedro en una hoja (Google Sheets, Excel o un mensaje) con estas columnas:

| Columna | Qué poner | Ejemplo |
|---|---|---|
| Idioma | `es` o `pt` | `es` |
| Mensaje | tu mensaje, tal cual | `me sacaron plata del cajero y no fui yo` |
| Forma | `fresco` o `parafraseo` | `fresco` |
| Tarjeta | el número de la tarjeta (`EX02`), o `propia` si inventaste la situación | `EX02` |
| Categoría (opcional) | si la sabes | `unrecognized_charge` |
| ¿Ambiguo? (opcional) | `sí` o `no`; si es sí, las dos categorías | `no` |
| Tus iniciales | para saber quién lo escribió | `LP` |

Luego otra persona del equipo **revisa la categoría de cada mensaje**. Si no están de acuerdo, se discute o se marca como ambiguo.

Si trabajas con el repositorio, los mensajes van en `evals/human/messages.csv`. Las columnas exactas están en [README.md](README.md). Ahí "fresco" es `method=fresh`, "parafraseo" es `method=paraphrase` y la tarjeta va en `seed`.

## Las tarjetas de situación

Cada tarjeta describe **lo que le pasó al cliente**, no lo que escribe. Escribe tu propio mensaje para esa situación. Puedes escribir varios mensajes para la misma tarjeta, y varias personas pueden usar la misma.

| Tarjeta | Situación | Categoría |
|---|---|---|
| EX01 | En tu estado de cuenta ves una compra en una tienda en línea de la que nunca has oído hablar. Tu tarjeta está contigo. | `unrecognized_charge` |
| EX02 | La app muestra que ayer alguien sacó efectivo de un cajero en otra ciudad. Tú estuviste en casa todo el día. | `unrecognized_charge` |
| EX03 | Lo mismo que EX02, pero escribes con prisa, en tres o cuatro palabras. | `unrecognized_charge` |
| EX04 | Perdiste tu tarjeta el sábado. Hoy ves tres compras que no hiciste. | `unrecognized_charge` |
| EX05 | Salió dinero de tu cuenta en una transferencia que nunca enviaste. Escribes informal, como en Argentina. | `unrecognized_charge` |
| EX06 | En el supermercado pasaron tu tarjeta dos veces: pagaste una sola vez, pero el resumen muestra dos cobros. | `wrongful_fee` |
| EX07 | Pagaste poco en una farmacia, pero el cargo aparece diez veces más alto. | `wrongful_fee` |
| EX08 | Cancelaste una tarjeta adicional hace meses y el banco te sigue cobrando su cuota anual. | `wrongful_fee` |
| EX09 | El banco te cobra un seguro que nunca contrataste. | `wrongful_fee` |
| EX10 | Una comisión del banco te parece mal cobrada. Escríbelo en dos o tres palabras, sin acentos. | `wrongful_fee` |
| EX11 | Te rechazaron la tarjeta en una gasolinera aunque tienes dinero. Quieres saber por qué. | `transaction_status` |
| EX12 | Ayer le mandaste dinero a tu hermana y todavía no le llega. | `transaction_status` |
| EX13 | Hace dos semanas reportaste un cargo y nadie te ha dicho nada desde entonces. | `transaction_status` |
| EX14 | Una compra en una gasolinera lleva tres días como "pendiente". | `transaction_status` |
| EX15 | Quieres saber cuánto crédito te queda en la tarjeta. | `balance_check` |
| EX16 | Pide el saldo de tu cuenta con la menor cantidad de palabras posible. | `balance_check` |
| EX17 | Quieres ver los movimientos de tu cuenta de esta semana. | `balance_check` |
| EX18 | Pídele al asistente que pase dinero de tus ahorros a tu cuenta corriente. | `move_money` |
| EX19 | Pide que el banco pague hoy tu tarjeta con el dinero de tus ahorros. | `move_money` |
| EX20 | Estás enojado y exiges que te devuelvan tu dinero, sin decir qué pasó. | `move_money` |
| EX21 | No quieres hablar con un robot: quieres una persona. | `human_agent` |
| EX22 | Quieres un número de teléfono para llamar a alguien del banco. | `human_agent` |
| EX23 | Quieres que tu caso lo vea un supervisor. | `human_agent` |
| EX24 | Perdiste tu tarjeta y quieres bloquearla. Hasta ahora no hay cargos raros. | `out_of_scope` |
| EX25 | Quieres saber qué requisitos piden para un préstamo personal. | `out_of_scope` |
| EX26 | Terminas la conversación dándole las gracias al asistente. | `out_of_scope` |
| EX27 | Hay algo raro en tu tarjeta, pero no dices si conoces el cargo o si el monto está mal. | ambiguo: `unrecognized_charge` o `wrongful_fee` |
| EX28 | Quieres que te devuelvan el dinero de una compra que no hiciste. | ambiguo: `unrecognized_charge` o `move_money` |
| EX29 | Preguntas por un cargo de ayer, sin decir si lo hiciste tú. | ambiguo: `transaction_status` o `unrecognized_charge` |
| EX30 | La cuota anual de este mes vino mucho más alta y preguntas cuánto estás pagando. | ambiguo: `wrongful_fee` o `balance_check` |
| EX31 | Quieres que "alguien" revise un cargo. | ambiguo: `human_agent` o `unrecognized_charge` |
| EX32 | Solo dos palabras sobre un cargo extraño. | ambiguo: `unrecognized_charge` o `wrongful_fee` |

## Los ejemplos (léelos al final, solo para parafrasear)

Los escribió una IA (Claude) para mostrar el formato. **No los leas antes de escribir tus mensajes frescos.** Si los necesitas para parafrasear, están en la columna `example` de [examples.csv](examples.csv), junto con la explicación de por qué cada uno lleva su categoría (columna `why`).

## Lista final antes de entregar

- [ ] La mayoría de mis mensajes son frescos (escritos sin mirar ejemplos).
- [ ] Cada parafraseo dice de qué tarjeta salió.
- [ ] Hay mensajes cortos y, si pude, alguno de retiro de cajero.
- [ ] Más o menos 1 de cada 5 es ambiguo.
- [ ] Ningún dato personal real.
- [ ] Puse mis iniciales.
