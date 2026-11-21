## EduCoins — Plan de Direcci´on T´ecnica

Plataforma web educativa gamificada

Para: Equipo de desarrollo — Dev 1, Dev 2, Dev 3

Versi´on: 1.0 · Fecha de inicio: Semana 1

## 1. Contexto del proyecto

EduCoins permite a profesores publicar actividades con recompensa en monedas virtuales; los estudiantes las resuelven, acumulan monedas y las canjean por puntos de nota. Sistema multi-rol: administrador, profesor y estudiante.

## Stack Tecnol´ogico (A elecci´on del equipo)

- Lenguaje/Framework: Libre elecci´on (ej. TypeScript/NestJS, Python/Django, PHP/Symfony, C++ con bibliotecas web, etc.), siempre respetando el patr´on MVC o API REST + Fron- tend separado.

- Base de datos: MySQL, PostgreSQL, o MongoDB.

- Editor de Ecuaciones: KaTeX o MathJax en el frontend.

- Entorno de ejecuci´on: Servidor local adecuado al lenguaje (Node, servidor embebido de Python/PHP, Tomcat, etc.).

## 2. Divisi´on del equipo

## 2.1. Dev 1 — Backend, Seguridad y Modelos

## Responsabilidades:

- Dise˜no de la base de datos y modelos base (User, Activity, Submission, Coin).

- L´ogica central de autenticaci´on y middlewares de control de roles.

- Gesti´on segura de subida de archivos (im´agenes/PDFs).

## 2.2. Dev 2 — Panel del Profesor y Administrador

## Responsabilidades:

- L´ogica y vistas para la creaci´on de actividades (texto, opci´on m´ultiple, minijuego).

- M´odulo de revisi´ on de entregas y calificaci´on (aprobaci´on/rechazo).

- Integraci´on del editor de texto y ecuaciones matem´aticas (KaTeX) para los enunciados.


## 2.3. Dev 3 — Panel del Estudiante y UI/UX

Responsabilidades:

- Interfaz del estudiante y resoluci´on de actividades.

- L´ogica de minijuegos en el frontend (ordenar palabras, memoria).

- Sistema de la ”Billetera”(canje de monedas) y Ranking general.

- Estilos globales y responsive design.

## 3. Flujo de trabajo en Git

- Ramas: main (solo el Tech Lead integra aqu´ı) →develop (rama de pruebas) →feature/devX-nombre-ta

- Regla de oro: Nunca hacer commit directo a develop ni main. Los conflictos se resuelven siempre con el Tech Lead.

## 4. Est´andares de C´odigo (Multi-lenguaje)

El Tech Lead establece que, sin importar el stack, se deben respetar estos principios:

- Prevenci´on de Inyecci´on SQL/NoSQL: NUNCA concatenar variables directamente en las consultas. Usar siempre sentencias preparadas (Prepared Statements) u ORMs/ODMs que automaticen el escapado de datos.

- Prevenci´on de XSS: Cualquier dato ingresado por el usuario debe ser escapado o sani- tizado antes de ser renderizado en la vista (HTML/Frontend).

- Manejo de Contrase˜nas: Prohibido guardar contrase˜nas en texto plano. Se debe usar bcrypt, Argon2 o funciones de hash equivalentes en el lenguaje elegido.

## 5. Protocolo de Bloqueos

- 1. 20 minutos de b´usqueda propia (Documentaci´on oficial, foros).

- 2. Preguntar al grupo del equipo (con un resumen del error).

- 3. Escalar al Tech Lead explicando: ¿Qu´e se intent´ o? ¿Cu´al es el error exacto?

- 4. Si el bloqueo supera las 2 horas, se exige una sesi´on en vivo de desbloqueo.
