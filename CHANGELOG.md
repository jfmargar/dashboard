# Changelog

Todos los cambios relevantes del panel. Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.

## [Unreleased]

## [0.7.0] - 2026-11-16

### Añadido
- `data/config.json` (fuera de git) define las zonas de la oficina y sus carpetas, cuál va destacada en rojo con su logotipo, cómo reconocer códigos de proyecto y las palabras que Datask ignora. Sin él, las zonas son Trabajo y Personal.
- Listo para publicar: licencia MIT, créditos de los gráficos, README como portada con capturas de la demo y resumen en inglés, guía de uso en `docs/guia.md`, página de presentación para GitHub Pages en `docs/`, imagen social de 1280×640 y la demo `dashboard-demo` para sacar capturas sin datos reales.
- La app de barra de menú de macOS tiene icono propio: un panel pixel-art con la oficina, las misiones y la bandeja. Se genera con `macos/make-icon.py`.

### Corregido
- `macos/install.sh` ya no falla con «Bootstrap failed: 5» al reinstalar con el servicio en marcha, que dejaba el panel parado.

### Seguridad
- El panel solo atiende a este Mac (sin proxy y con `localhost` como dirección) y a `tailscale serve` desde la tailnet. Por Tailscale Funnel, otro proxy o la red local responde 403 en todo, página incluida, y una web que se haga pasar por `localhost` (DNS rebinding) no entra. Antes, una petición que llegaba por un proxy sin la cabecera de Tailscale contaba como del propio Mac y podía mandar órdenes.
- Los dispositivos de la tailnet sin usuario (con etiqueta) pueden ver el panel pero no mandar órdenes.

### Cambiado
- Nada propio de una empresa en el código: la zona, la marca, el logotipo y los códigos de proyecto pasan a la configuración local. Ya no se importan alias de Workhub.

## [0.6.1] - 2026-11-03

### Corregido
- Una sesión de Claude cuyo registro acaba en una captura enorme ya no desaparece del panel a ratos. Con ella desaparecía también la sala activa de la oficina, porque su coordinadora parecía terminada.

## [0.6.0] - 2026-11-03

### Añadido
- Pruebas de inicio a fin de la Bandeja con el servidor real y CLI falsos: accesos, planes, correcciones, envíos a GitLab, GitHub, Datask y sesiones, fallos, archivado, seguimiento, dictado y reinicio. `DASHBOARD_DATA_DIR` permite lanzar una instancia de prueba sin tocar los datos de verdad.
- Las sesiones de la app de Claude tienen «Abrir con Remote Control» en la ficha y Misiones: abre la misma conversación en claude.ai/code o en la app del iPhone.
- Las sesiones de Codex tienen un enlace a su app: en el Mac abre el hilo en la app de Codex y en el móvil abre Codex en la app de ChatGPT, donde se ven los hilos del Mac emparejado.

### Cambiado
- Momentos en la oficina: chispas cuando una sesión termina, un «?» rojo que parpadea sobre la que lleva 10 minutos trabajando sin escribir nada y, desde las 20:00 con todo parado, la pizarra con cuántas sesiones se han movido hoy.
- Tres pestañas (Oficina, Misiones y Bandeja) y un botón «Apuntar» siempre a mano. La lista que era la pestaña Panel está ahora en Misiones (Tablero / Lista) y «Nueva sesión» se abre desde la Bandeja o desde la ficha de un proyecto.
- Recepción en la zona común (oficinas anchas): un mostrador junto a la puerta con lo que te espera haciendo cola; tocarlo lleva a la siguiente.
- Botones, pestañas y selectores con esquinas pixel, y los controles de la oficina en la fuente pixel.
- La oficina empieza por lo que se mueve: en el móvil abre en la planta que te espera o trabaja, y las salas sin uso van plegadas en una fila con «+N» que las despliega.
- Los puestos enseñan los pasos del plan («3/7» y una barra) y, de cerca, un bocadillo con lo que está haciendo la sesión que más urge.
- Los letreros usan el nombre de la app cuando lo hay («El Molino» en vez de «PuntosClub-Molino») y cortan por palabras en lugar de dejar letras sueltas.
- El dictado muestra bajo el cuadro en qué paso va (abriendo el micrófono, grabando con contador y transcribiendo con indicador de carga), así que al pulsar parar ya se ve que la transcripción está en marcha.

### Corregido
- Una sesión de Claude que paras (desde el panel, la app o la terminal) ya no sigue saliendo como «trabajando» durante 15 minutos.
- Parar una orden de Claude ya no enseña «Claude devolvió un error.».
- El servidor también rechaza órdenes a sesiones de la app de Claude, no solo la interfaz.
- Una nota enviada a GitLab ya no se archiva sola si el issue sigue abierto pero su hito está cerrado.

## [0.5.1] - 2026-10-31

### Corregido
- Los registros antiguos de subagentes de Claude que la app reescribe ya no hacen aparecer proyectos como trabajando: la actividad se calcula con la fecha del último mensaje.

## [0.5.0] - 2026-10-31

### Añadido
- Filtros Todas, Pendientes y Enviadas con contadores en la Bandeja. Abre en Pendientes; las notas enviadas conservan sus enlaces y seguimiento en Enviadas.
- Vista Ahora en la ficha de sesión: último encargo y respuesta actual, con el historial accesible a un toque.

### Cambiado
- Bandeja con captura destacada, tarjetas compactas, proyecto y estado visibles, detalles y opciones plegados y acceso directo a elegir proyecto. En pantallas anchas usa dos columnas; editores y confirmaciones ocupan el ancho completo.
- Una sola ventana activa entre fichas, Nueva sesión y el cuadro de Misiones; el fondo permite cerrarla y evita tocar controles por debajo. Se conservan los borradores al cambiar de nota o cerrar un cuadro.
- Controles táctiles de al menos 44 px, acciones que saltan de línea y formularios adaptados al ancho, al teclado y a las zonas seguras, incluidas tablets grandes de hasta 1366 px.
- Las fichas se abren a altura completa en móvil; el equipo queda plegado y Parar está disponible en la barra superior. Con poca altura se usa un único desplazamiento para alcanzar las acciones.

### Corregido
- Las respuestas dejan de repetirse en el bloque de la orden y los avances sustituyen el texto de la vista principal.
- Tocar acciones de la cabecera de una ficha ya no activa el gesto de cambiar su altura.
- Bandeja conserva el foco y la selección del buscador de Datask durante los refrescos y descarta respuestas de consultas anteriores al cambiar de confirmación.
- Cambiar de vista recoge editores y desplegables, retira el foco anterior y evita acumular ventanas.

## [0.4.0] - 2026-10-31

### Añadido
- Nivel de permisos **Auto**, por defecto al lanzar y al continuar sesiones: trabaja sin pedirte permisos, como las apps. Claude usa su modo auto (decide qué es seguro) y Codex va sin sandbox, igual que la app de Codex de este Mac. Editar y Solo mirar siguen disponibles.
- Estado «Terminada»: una sesión que cierra su turno sin preguntarte nada ya no sale en «Te toca». En la app de Claude se mira si el cierre del turno lleva pregunta o queda bloqueado; en Codex, si usó su herramienta para preguntarte; si no hay señal, si su último mensaje acaba en pregunta. En la oficina descansa en la zona común con un visto verde y en Misiones pasa a «Hechas».
- Al lanzar una sesión desde la Bandeja eliges el nivel de permisos, como en «Nueva sesión»: Auto, Editar o Solo mirar.
- La Bandeja reconoce mejor el proyecto: Haiku ve también cómo se llama cada app en el móvil (por ejemplo «¿Sofá y peli?») y de qué va según su README. Cuando duda, propone hasta tres candidatos que eliges con un toque, y lo que dijiste en la nota («la app de sofá») queda como alias para la próxima vez.

### Cambiado
- La Bandeja ya no ofrece Datask en los proyectos personales, que no están allí; sí en los de trabajo, en los que tienen código de proyecto y en los que ya tienen proyecto de Datask recordado.
- A las sesiones de la app de Claude ya no se les escribe desde el panel: lo enviado se ejecutaba aparte, sin las herramientas de la app, y no se veía en la app. La ficha y Misiones indican que se les hable desde la app o con Remote Control (issue #3).
- En Misiones, Hablar, Escribir y Archivar van en una sola barra bajo la coordinadora: Archivar, solo con icono, a la derecha y lejos de los otros; al tocarlo, la barra pide confirmación con «No» y «Sí, archivar». En la ficha, Archivar está arriba, junto a Cerrar.

### Corregido
- Las sesiones de Codex se liberan al terminar, parar o pedir respuesta o aprobación, para continuarlas desde su app. Otra orden del panel retoma el mismo hilo y respeta el bloqueo si otro cliente lo tiene abierto. Las esperas interactivas se interrumpen sin aprobar nada y pueden necesitar repetirse al continuar.
- La conversación en vivo de Codex reconcilia cada mensaje por su identificador y no arrastra texto del anterior.
- La ficha de una sesión tiene un solo scroll, el de la conversación: la cabecera queda arriba y el cuadro para escribir siempre a la vista abajo, sin tener que bajar hasta el final.
- Abrir la ficha desde Misiones sin haber pasado por la oficina (en el móvil) ya no falla.
- En la Bandeja, «Volver a proponer» tiene en cuenta lo que corregiste (título, descripción) y conserva el proyecto que elegiste; antes volvía a partir de la nota original y lo perdía.
- Con el teclado abierto en el iPhone o el iPad, la barra de abajo se esconde y el cuadro para hablar con la coordinadora y la hoja de la ficha quedan encima del teclado.

## [0.3.1] - 2026-10-30

### Añadido
- «Archivar» en la ficha de cada sesión (Oficina y Misiones) y en todos los equipos de Misiones que no están trabajando, también en «Te esperan». Una coordinadora se archiva con sus delegadas.

### Corregido
- Misiones ya no pone en «Te esperan» a una coordinadora que espera a sus delegadas: está trabajando, como cuenta el resto del panel.

## [0.3.0] - 2026-10-30

Vista Misiones: qué hace cada equipo de agentes y por dónde va, con su propia escena pixel art.

### Cambiado
- Una coordinadora que espera a sus delegadas ya puede recibir mensajes del panel; antes contaba como «trabajando».

### Añadido
- Vista Misiones: un kanban con aspecto de juego donde cada proyecto activo es un equipo (coordinadora y delegadas) en la sala de quien más urge: Te esperan, Trabajando o En pausa. Cada personaje lleva el emblema de Claude o de Codex, su ficha enseña el encargo, los pasos del plan y la última acción, y el equipo camina a su nueva sala cuando cambia de estado. Tocar abre la ficha de siempre.
- En Misiones, «Hablar» y «Escribir» en cada equipo para mandar un mensaje a la coordinadora sin abrir su ficha, con el dictado de la Bandeja y confirmación antes de enviar.
- El tablón «Por lanzar» con las notas de la Bandeja que tienen plan, y las salas «Revisión» (issue abierto) y «Hechas» (issue cerrado) para los equipos que salieron de una nota.
- Archivar equipos o sesiones en pausa desde Misiones: dejan de salir en el panel hasta que vuelven a tener actividad.
- El panel sabe en qué tarea va cada sesión activa: los pasos del plan que se marca el agente, el paso en curso y lo último que ha hecho, en palabras. Es la base de la vista Misiones.

## [0.2.1] - 2026-10-30

Oficina fluida en el iPhone y salas sin uso recogidas en un pasillo.

### Cambiado
- Los proyectos sin uso ya no ocupan un puesto entero: aparecen como puertas con su placa en el pasillo «Salas sin uso» y se pueden tocar igual. Vuelven a su puesto en cuanto alguien trabaja o te espera.
- En el móvil, el selector de planta y el zoom van debajo de la oficina en lugar de taparla.

### Corregido
- La oficina va fluida en el iPhone: solo se dibuja la parte que se ve (antes cada fotograma tardaba unos 300 ms con muchos proyectos) y se detiene en segundo plano.

## [0.2.0] - 2026-10-30

Panel pensado para el móvil y la tablet, con bandeja de entrada y conversación en vivo.

### Añadido
- Bandeja de entrada: notas por voz o por escrito con un plan propuesto por Haiku (proyecto, título y descripción) que puedes corregir, pedir de nuevo o archivar.
- Desde la bandeja, con confirmación: issues en GitLab o GitHub, tareas en Datask con el proyecto propuesto y recordado, y sesiones de Claude o Codex con el encargo de la nota, que se abren aunque tarden en aparecer.
- Seguimiento de lo enviado desde la bandeja cada 15 minutos para archivar la nota al cerrarse, y buzón junto a la puerta de la oficina con las notas pendientes.
- Conversación reciente en la ficha de cada sesión, en vivo por SSE, conservando la posición al leer mensajes anteriores y con «Seguir el final».
- Uso de Claude (ventana de 5 h y semanal) junto al de Codex.
- Uso táctil en móvil y tablet: cabecera en una línea con el uso recogido en un botón, barra de navegación abajo (o raíl en horizontal) y la oficina a todo el alto.
- La ficha sube como hoja inferior con tres alturas y se arrastra; la oficina se sigue viendo detrás.
- El botón atrás del sistema cierra la ficha o vuelve de una sesión a su puesto.
- Cámara de la oficina con gestos: arrastrar con inercia, pellizcar para acercar y doble toque en un puesto para acercar o volver.
- La cámara vuela con suavidad a lo que eliges (selector de proyecto, doble toque, Vista general) y deja lo seleccionado en la parte que no tapa la ficha. Respeta «reducir movimiento».
- Botón «te esperan» sobre la oficina que va una a una por las sesiones que te esperan o piden aprobación.
- Menú circular al mantener pulsado un personaje (o con clic derecho): Abrir, Contestar, Aprobar y Parar, solo los que apliquen. Aprobar y Parar dejan la confirmación preparada en la ficha; nunca actúan con un solo gesto.
- En el móvil, la oficina va por plantas por zona (trabajo, personal y otros): se pasa de una a otra deslizando en horizontal o con las flechas, y elegir un proyecto o la cola lleva a su planta.
- Modo ambiente para la tablet apoyada: tras un minuto sin tocar quedan solo la oficina y el reloj, la pantalla no se apaga y la cámara pasea por los puestos con actividad. Se desactiva con el botón «Ambiente».
- Aviso cuando aparece algo que te toca: vibración donde se pueda y destello del botón «te esperan».

### Cambiado
- Tocar un personaje acierta aunque se vea pequeño: vale cualquier punto a menos de 22 px.
- Navegador de referencia: Safari de iOS.
- El zoom es continuo y ya no cambia la colocación de los puestos; Ctrl/⌘ + rueda y el pellizco del trackpad acercan con suavidad.
- De noche la oficina se oscurece menos en el móvil para que se sigan viendo los personajes.

### Corregido
- Un CLI falso que no existe ya no cae en el CLI real.
- El estado de las sesiones de Codex ya no confunde una llamada a herramienta o una captura grande con un turno terminado, y una coordinadora con hijas trabajando sigue ocupada.
- Cambiar el tamaño de la ventana con otra pestaña abierta ya no rompe el dibujo de la oficina.

## [0.1.0] - 2026-10-29

Primera versión del panel de agentes para la pantalla del escritorio y la tablet.

### Añadido
- Panel con las sesiones de Codex y Claude Code de este Mac, agrupadas por proyecto y por zona (trabajo, personal y otros), con su estado: trabajando, te toca o en pausa.
- Uso de Codex (ventana de 5 h y semanal) leído de sus registros locales.
- Vista Oficina en pixel art con los gráficos de pixel-agents y los personajes MetroCity: un puesto por proyecto, quien trabaja sentado frente a su PC, quien espera de pie y quien descansa en la zona común. Los personajes caminan entre sitios, entran y salen por la puerta.
- Coordinadoras y sesiones de issue enlazadas (Codex y app de Claude), con líneas entre ellas al seleccionarlas.
- Subagentes como ayudantes que trabajan junto a la mesa de su sesión.
- Luz según la hora, sombras, microanimaciones, letreros nítidos, tarjeta flotante y zoom.
- Órdenes a sesiones existentes y sesiones nuevas desde el panel, con confirmación y niveles de permisos (Editar o Solo mirar), actividad en vivo y botón de parar.
- Codex a través de su app-server: aprobaciones desde la ficha, indicaciones sobre la marcha, sesiones visibles en la app de escritorio y carpetas guardadas de la app en "Nueva sesión".
- Dictado por voz local con mlx-whisper en las órdenes, indicaciones y nuevas sesiones.
- Placa roja y logotipo de la empresa en los puestos de trabajo.
- Acceso desde la tablet con `tailscale serve`, aceptando órdenes solo de la cuenta dueña del Mac.
- Servicio de macOS que arranca el panel con el Mac y app de barra de menú para verlo y controlarlo.
- Versión, rama y commit en el pie del panel.
