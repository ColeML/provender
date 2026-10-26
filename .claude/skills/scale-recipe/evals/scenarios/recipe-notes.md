# Scaling fixture (no API access — use only this data)

The user said: "Scale the chicken fajitas to 12 servings."

Responses for calls you might make. Use a response only for a call you actually choose to make.

## GET /recipes/chicken-fajitas
{"name":"recipes/chicken-fajitas","recipeId":"chicken-fajitas","title":"Chicken Fajitas","sourceUrl":"https://www.budgetbytes.com/sheet-pan-chicken-fajitas/","baseServings":8,"totalMin":30,"costEstimate":12,"tags":["main","quick","sheet pan"],"instructions":["Slice the peppers and onion.","Toss chicken and vegetables with oil and spices.","Roast at 425F for 20 minutes on one sheet pan.","Warm the tortillas and serve with lime."],"rating":4,"notes":["Our crew eats about double what it says","Go light on the cayenne, the kids can't take the full amount"]}

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
