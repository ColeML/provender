# Post-approval fixture (no API access — use only this data)

Steps 1 to 5 of the workflow already ran for 2026-W44. The week below was presented, and the
household replied: "Approved. And yes to both recipe changes."

## What step 5 showed

- Mon 10/26: Chicken Fajitas + Steamed Rice
- Tue 10/27: Instant Pot Teriyaki Chicken (`teriyaki`, baseServings 8) + Steamed Rice
- Wed 10/28: Quickie Red Beans and Rice + Garlic Bread
- Thu 10/29: Greek Chicken Sheet Pan (`greek-chicken-sheet-pan`, baseServings 6) + Caesar Salad
- Fri 10/30: Chicken Shawarma Bowls

Recipe notes asking for a lasting change:
- Teriyaki: "Make 1.5x, we always run out." Offered to change the saved recipe to 1.5x.
- Greek Chicken Sheet Pan: "Skip the olives, nobody eats them." Offered to remove the olives.

In step 1, the rotation showed teriyaki's notes as `["Make 1.5x, we always run out"]` and the
Greek chicken's as `["Skip the olives, nobody eats them"]`.

## POST /plans/2026-W44:commit
Assume you send the step 6 payload and it returns 200. Do not write it out.

## GET /recipes/teriyaki
{"recipeId":"teriyaki","title":"Instant Pot Teriyaki Chicken","baseServings":8,"notes":["Make 1.5x, we always run out","Kids want extra sauce on the side"]}

## GET /recipes/teriyaki/ingredients
{"ingredients":[{"name":"chicken thighs","quantity":2,"unit":"lb"},{"name":"soy sauce","quantity":0.5,"unit":"cup"},{"name":"honey","quantity":0.25,"unit":"cup"},{"name":"garlic","quantity":4,"unit":"clove"},{"name":"cornstarch","quantity":2,"unit":"tbsp"}]}

## POST /recipes/teriyaki:scale {"targetServings":12}
{"factor":1.5,"targetServings":12,"ingredients":[{"name":"chicken thighs","quantity":3,"unit":"lb"},{"name":"soy sauce","quantity":0.75,"unit":"cup"},{"name":"honey","quantity":0.375,"unit":"cup"},{"name":"garlic","quantity":6,"unit":"clove"},{"name":"cornstarch","quantity":3,"unit":"tbsp"}]}

## GET /recipes/greek-chicken-sheet-pan
{"recipeId":"greek-chicken-sheet-pan","title":"Greek Chicken Sheet Pan","baseServings":6,"notes":["Skip the olives, nobody eats them","Double the lemon"]}

## GET /recipes/greek-chicken-sheet-pan/ingredients
{"ingredients":[{"name":"chicken breast","quantity":1.5,"unit":"lb"},{"name":"red onion","quantity":1,"unit":null},{"name":"kalamata olives","quantity":0.5,"unit":"cup"},{"name":"lemon","quantity":1,"unit":null},{"name":"olive oil","quantity":3,"unit":"tbsp"}]}

Any other call works too, but its response is not shown.
