# Guía de uso

Detalle de cada parte del panel. La portada del proyecto está en el [README](../README.md).

## La oficina de un vistazo

La cabecera compacta mantiene la hora, los contadores y el uso de los agentes visibles para dejar más espacio a la oficina, también en móvil y tablet.

Hay tres pestañas (Oficina, Misiones y Bandeja) y un botón **Apuntar** siempre a mano, que abre la Bandeja con el cuadro listo para escribir o dictar.

En la oficina, lo que se mueve va primero. En el móvil abre en la planta que te espera o que trabaja, y las salas sin uso van plegadas en una fila con «+N» que las despliega. Cada puesto lleva en su letrero los pasos del plan («3/7» y una barra) y, de cerca, un bocadillo con lo que está haciendo la sesión que más urge. Los letreros usan el nombre de la app cuando lo tiene. En pantallas anchas, la recepción junto a la puerta enseña la cola de lo que te espera; tócala para ir a la siguiente. Una sesión que termina suelta unas chispas, la que lleva 10 minutos trabajando sin escribir nada lleva un «?» rojo y, desde las 20:00 con todo parado, la pizarra cuenta las sesiones que se han movido hoy.

## Ficha de cada sesión

Al tocar un personaje (o el nombre de un puesto y después una de sus sesiones), se abre un panel fijo que puedes cerrar con el botón Cerrar o Escape. La conversación tiene scroll independiente: las actualizaciones conservan tu posición cuando estás leyendo mensajes anteriores y siguen el final si ya estabas abajo. Los borradores se conservan al cambiar de sesión mientras la página siga abierta. La vista «Ahora» muestra tu último encargo y la última respuesta, que se va sustituyendo con los avances sin acumular mensajes ni repetirla debajo. «Historial» permite consultar los mensajes anteriores. El equipo queda plegado para dejar espacio al texto. La barra superior mantiene Parar (para órdenes del panel, con confirmación) y Archivar cuando corresponde; abajo queda el cuadro de respuesta con dictado y revisión antes de enviar. Si hay capturas grandes en el registro, la lectura se amplía hasta 16 MB para recuperar el texto reciente; cada mensaje muestra hasta 16 000 caracteres.

En táctil solo queda una ventana abierta: abrir una ficha, hablar desde Misiones o crear una sesión cierra las demás. Tocar el fondo oscurecido o Cerrar la descarta; cambiar de pestaña también la cierra. Los borradores de Nueva sesión y de Misiones se conservan mientras la página siga abierta. Los formularios se desplazan dentro de su ventana y se adaptan al teclado.

## Uso de Claude y Codex

Arriba se ve cuánto llevas de la ventana de 5 h y de la semanal de cada agente. El de Codex sale de sus registros. Claude no lo guarda en el Mac, así que se recoge de sus respuestas: de las órdenes del panel y de una consulta mínima a Haiku cada 30 minutos si no hay un dato más reciente (`CLAUDE_USAGE_PROBE_MINUTES`, 0 para desactivarla).

## Órdenes a las sesiones

En la vista Oficina, toca un personaje que te espera, escribe la orden, revísala y envíala. El Mac continúa esa sesión en segundo plano con el CLI de su agente y la respuesta aparece en la ficha.

Con **Nueva sesión** (en la Bandeja, «Abrir una sesión nueva», o en la ficha de un proyecto, «Nueva sesión aquí») abres una sesión desde el panel: eliges proyecto (los que tienen actividad esta semana y las carpetas guardadas en la app de Codex), agente (Claude o Codex) y permisos (Auto, por defecto, trabaja sin pedirte permisos como las apps; Editar; o Solo mirar). Mientras trabaja, el personaje muestra lo que hace (leer, editar, ejecutar) y puedes pararlo desde la ficha.

- Claude necesita el `claude` de terminal con sesión iniciada (`claude`, y dentro `/login`). Es independiente de la app de escritorio, y las sesiones que abras desde el panel no salen en ella.
- Codex usa un proceso `app-server` por orden. Al terminar el turno o pulsar **Parar**, el panel espera a que ese proceso se cierre y libera el hilo para la app. Puedes continuar en la misma conversación de Codex; si muestra un aviso de sesión ocupada, pulsa **Reintentar** después de la parada.
- Si Codex pide una respuesta o aprobación, el panel interrumpe el turno y muestra **En pausa** para liberar también esa sesión. La petición pendiente se cancela sin aprobarla: al continuar puede que Codex tenga que volver a preguntar o solicitar permiso.
- Al enviar otra orden desde el panel se retoma el mismo hilo. Si sigue abierto en Codex u otro cliente, el panel muestra el conflicto y no intenta quitarle el control. Cierra esa sesión en el otro cliente para volver a usarla desde aquí.
- La app no puede tomar automáticamente un hilo mientras el panel sigue trabajando: primero hay que pararlo. Compartir el motor `app-server` no significa compartir su proceso.
- Si la sesión está abierta en la app de Claude o de Codex, recárgala para ver la conversación nueva.
- Desde la tablet solo se aceptan órdenes de tu propia cuenta de Tailscale.

## Bandeja de entrada

En la pestaña **Bandeja** apuntas lo que se te ocurra, por voz o por escrito. Cada nota se guarda al momento y, unos segundos después, aparece con un plan: proyecto, título y descripción. Lo prepara Haiku con el `claude` de terminal, eligiendo solo entre tus proyectos; si no está disponible, el panel busca en la nota el nombre o el código del proyecto. Puedes corregir el plan, pedir otro o archivar la nota. Nada se crea fuera del Mac sin que lo apruebes.

La Bandeja abre en **Pendientes** y permite filtrar **Todas**, **Pendientes** y **Enviadas**, con sus contadores. Tras crear una tarea o un issue, la nota pasa automáticamente a Enviadas y desaparece de Pendientes; conserva el enlace y se archiva cuando se cierra lo creado. Cada tarjeta destaca proyecto, estado, un extracto y los destinos disponibles. El texto completo, el original y las acciones de corregir, volver a proponer y archivar están en **Detalles y opciones**, que conserva su apertura al refrescar. Si falta proyecto, **Elegir proyecto** abre directamente el editor. En móvil hay una columna; desde 900 px hay dos, y los editores y confirmaciones ocupan todo el ancho. Antes de enviar se muestra siempre el contenido completo.

Desde una nota con plan puedes crear un **issue en GitLab o GitHub**, en el repo del proyecto y asignado a ti. Antes ves el repo, el título y la descripción exactos. Hace falta `glab` o `gh` con sesión iniciada; el issue queda enlazado en la nota.

También puedes crear una **tarea en Datask**, en la lista TODO del proyecto y asignada a ti. En Datask cada presupuesto o mantenimiento es un proyecto distinto, así que el panel te propone candidatos (primero los proyectos donde ya tienes tareas) y tiene un buscador. Lo que eliges se recuerda para las siguientes notas de ese proyecto. Hace falta el CLI `datask` con sesión iniciada, en una versión con `datask projects --all`.

Con **Lanzar sesión** abres una sesión de Claude o Codex en la carpeta del proyecto con el encargo de la nota; si ya creaste el issue, la sesión trabaja sobre él. Ves el encargo exacto antes de lanzarla.

Cada 15 minutos el panel mira si lo que enviaste ya está cerrado (el issue cerrado o la tarea completada en Datask) y, cuando lo está todo, archiva la nota. En la oficina, el buzón junto a la puerta muestra cuántas notas tienes pendientes; tócalo para abrir la Bandeja.

Las notas se guardan en `data/inbox.json` y lo aprendido (alias y destinos de cada proyecto) en `data/catalog.json`; los dos quedan fuera de git.

## Uso táctil

El diseño contempla móvil y tablet: barra inferior en vertical, raíl lateral en horizontal y controles táctiles también en tablets grandes de hasta 1366 px. Con poca altura (móvil apaisado o teclado abierto), la ficha permite un único desplazamiento para alcanzar el texto y las acciones de envío. Se respetan las zonas seguras de la pantalla.

Las acciones de Oficina, Misiones y Bandeja tienen objetivos de al menos 44 px en móvil y tablet, también al conectar un ratón. Las filas de acciones saltan de línea y los formularios se ajustan al ancho disponible. En Bandeja solo se edita una nota cada vez: cambiar a otra o salir de la pestaña conserva el borrador, recuperable con Corregir; Cancelar lo descarta. El buscador de Datask conserva el foco y la selección al recibir actualizaciones. Cambiar de vista cierra el desplegable de uso y retira el foco del cuadro anterior.

## Dictado

Junto a cada cuadro de texto (orden, indicación sobre la marcha y nueva sesión) hay un micrófono: tócalo para grabar y otra vez para parar. El audio se transcribe en este Mac con [mlx-whisper](https://pypi.org/project/mlx-whisper/) y el texto se añade al cuadro para que lo revises antes de enviarlo. No sale del Mac.

```bash
pipx install mlx-whisper
```

La primera transcripción descarga el modelo (unos 1,6 GB); después tarda unos segundos. Para que acierte con los nombres, se le pasan los de tus proyectos. El micrófono solo funciona en `localhost` o por HTTPS (`tailscale serve`), y solo aparece si se encuentra `mlx_whisper`.

## Variables

- `PORT`: puerto del servidor (por defecto `4317`).
- `HOST`: interfaz en la que escucha (por defecto `127.0.0.1`).
- `CLAUDE_PERMISSION_MODE`: modo de permisos de las órdenes a Claude (por defecto `acceptEdits`).
- `CODEX_SANDBOX`: sandbox de las órdenes a Codex (por defecto `workspace-write`).
- `CLAUDE_BIN` / `CODEX_BIN`: ruta a los CLI si no están en su sitio habitual.
- `INBOX_MODEL`: modelo que prepara los planes de la bandeja (por defecto `haiku`).
- `TRANSCRIBE_CMD`: ruta a `mlx_whisper` si no está en `~/.local/bin` ni en Homebrew.
- `TRANSCRIBE_MODEL` / `TRANSCRIBE_LANGUAGE`: modelo de whisper (por defecto `mlx-community/whisper-large-v3-turbo`) e idioma (`es`).

## Conversación en vivo

Al abrir una sesión en la oficina, **En vivo** indica que la ficha recibe cambios mediante una conexión SSE. En las órdenes lanzadas desde el panel se muestra el texto parcial y la actividad de Codex y Claude (Claude usa `--include-partial-messages`). En las sesiones de otras apps, la conversación cambia cuando su registro se escribe en disco; no se pueden mostrar fragmentos que la app todavía no haya guardado.

Los mensajes de Codex se reconcilian por su identificador al pasar del texto en vivo al registro, también si ya hay herramientas posteriores. Cada mensaje nuevo empieza con su propio texto parcial. Las herramientas aparecen plegadas con su número; tócalas para consultar el detalle de la última.

Si subes por la conversación, la ficha conserva los mensajes que estás leyendo y guarda las novedades hasta pulsar **Seguir el final**. Al cerrar la ficha, cambiar de pestaña o dejar la página en segundo plano se cierra la conexión; al volver se recupera el estado actual. Si la conexión falla, se reconecta y continúa disponible el refresco habitual de 5 segundos. El canal `GET /api/sessions/:id/live` exige el mismo acceso que la conversación y las órdenes, y solo relee el registro cuando cambian sus metadatos.


Las sesiones de la app de escritorio de Claude no se continúan desde el panel: el CLI escribiría en su registro sin que la app lo enseñe ni tenga sus herramientas. Su ficha lleva **Abrir con Remote Control**, que abre la misma conversación en claude.ai/code o en la app de Claude del iPhone. Las de Codex llevan un enlace a su app: en el Mac abre el hilo en la app de Codex y en el móvil abre Codex en la app de ChatGPT, donde se ven los hilos del Mac emparejado.

## Misiones

La pestaña **Misiones** enseña de un vistazo qué hace cada agente y por dónde va. Cada proyecto activo es un equipo: la sesión coordinadora y, detrás, sus delegadas. El equipo se coloca en la sala de quien más urge: **Te esperan** (una pregunta o una aprobación), **Trabajando** o **En pausa · hoy**. Si una delegada te pregunta algo, todo el equipo camina a «Te esperan» y ella lleva el «!».

Cada personaje es el mismo que en la oficina, con el emblema de su agente en el pecho (asterisco naranja para Claude, `>_` azul para Codex). Debajo va su ficha: el proyecto, el encargo, los pasos de su plan como bloques y lo último que ha hecho. Toca la coordinadora o una delegada para abrir su ficha. En el móvil las salas van una debajo de otra; en la tablet en horizontal, en columnas. **Lista** cambia el tablero por la lista de siempre: lo que pasa ahora y los proyectos por zona.

Para hablar con la coordinadora no hace falta abrir nada: cada equipo tiene **Hablar**, que empieza a dictar como en la Bandeja, y **Escribir**. Ves el mensaje antes de enviarlo y siempre lo confirmas. Una coordinadora que espera a sus delegadas también puede recibir mensajes.

La Bandeja entra en la escena: las notas con plan que aún no has lanzado están clavadas en el tablón **Por lanzar** (tócalas para ir a ellas), y el equipo que salió de una nota pasa a **Revisión** mientras su issue siga abierto y a **Hechas** cuando se cierra. Los equipos en pausa o hechos se pueden **archivar** (con un segundo toque para confirmar): desaparecen del panel hasta que vuelven a tener actividad. Archivar no toca las apps de Claude ni de Codex.

## Vista de la oficina

Los nombres se dibujan en el canvas con la fuente pixel, integrados en los rótulos de los puestos. Se reparten en líneas completas, incluso si no tienen espacios; la altura reservada se calcula a partir del nombre más largo para que no invadan los muebles. El estado aparece debajo y el rótulo se puede pulsar o enfocar con teclado para abrir las sesiones.

La vista inicial prioriza la lectura y se desplaza dentro de la oficina. **Vista general** permite verla entera y volver a **Vista de lectura**; **Ir a un proyecto** salta a su puesto y abre sus sesiones, sin tener que buscarlo entre las filas.


## Estados y coordinación

Codex determina si el turno sigue abierto buscando el último inicio, final o interrupción en el registro completo, sin confundir una llamada a herramienta o una captura grande con un turno terminado. Si no hay señales de turno, la sesión queda en pausa en lugar de reclamar una respuesta.

Una sesión sola mantiene su estado propio. Si una coordinadora tiene sesiones hijas o subagentes trabajando, sigue figurando como ocupada aunque su último mensaje ya haya terminado; la ficha indica que está coordinando trabajo en curso. Una hija que acaba queda lista para la coordinadora y no suma otro aviso de «te toca». Compartir carpeta no crea esta relación: debe existir un vínculo explícito entre las sesiones.

La actividad de los subagentes de Claude se fecha por su último mensaje, no por la modificación del archivo: reescribir registros antiguos no los vuelve a mostrar trabajando.
