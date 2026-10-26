# Scaling fixture (no API access — use only this data)

The user said: "Scale the chicken fajitas to 12 servings."

Responses for the calls below. Any other call would also work, but its response is not shown: list it under `EXTRA CALLS:` and carry on without its data.

## GET /recipes/chicken-fajitas/ingredients
{"ingredients":[
 {"name":"chicken breast","quantity":2,"unit":"lb","notes":"sliced thin"},
 {"name":"bell pepper","quantity":3,"unit":null,"notes":null},
 {"name":"yellow onion","quantity":1,"unit":null,"notes":null},
 {"name":"olive oil","quantity":2,"unit":"tbsp","notes":null},
 {"name":"chili powder","quantity":1,"unit":"tbsp","notes":null},
 {"name":"cumin","quantity":2,"unit":"tsp","notes":null},
 {"name":"cayenne","quantity":0.25,"unit":"tsp","notes":null},
 {"name":"salt","quantity":1,"unit":"tsp","notes":null},
 {"name":"flour tortillas","quantity":16,"unit":null,"notes":null},
 {"name":"lime","quantity":1,"unit":null,"notes":"cut in wedges"}
]}

## POST /recipes/chicken-fajitas:scale {"targetServings":12}
{"factor":1.5,"targetServings":12,"ingredients":[
 {"name":"chicken breast","quantity":3,"unit":"lb","notes":"sliced thin"},
 {"name":"bell pepper","quantity":4.5,"unit":null,"notes":null},
 {"name":"yellow onion","quantity":1.5,"unit":null,"notes":null},
 {"name":"olive oil","quantity":3,"unit":"tbsp","notes":null},
 {"name":"chili powder","quantity":1.5,"unit":"tbsp","notes":null},
 {"name":"cumin","quantity":1,"unit":"tbsp","notes":null},
 {"name":"cayenne","quantity":0.375,"unit":"tsp","notes":null},
 {"name":"salt","quantity":1.5,"unit":"tsp","notes":null},
 {"name":"flour tortillas","quantity":24,"unit":null,"notes":null},
 {"name":"lime","quantity":1.5,"unit":null,"notes":"cut in wedges"}
]}
