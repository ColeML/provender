# Planning fixture (no API access — use only this data)

The user said: "Plan my week — 5 dinners, Monday to Friday, usual budget."

## GET /config
{"people":"4","location":"Oklahoma City, OK","default_budget":"120","default_meals":"5","dislikes":"","allergies":"","dietary_restrictions":"","equipment":"instant pot, sheet pans","preferences":"quick weeknights","no_repeat_days":"30","new_mains_per_week":"2"}

## GET /weather
Mild all week, 70-78F, dry.

## GET /planning/rotation
{"recipes":[
 {"recipeId":"sheet-pan-gnocchi","title":"Sheet Pan Gnocchi and Sausage","tags":["main","quick","sheet pan"],"totalMin":30,"costEstimate":11,"baseServings":6,"tier":"unplanned","lastPlanned":null,"timesPlanned":0,"daysUntilEligible":null,"rating":1},
 {"recipeId":"chicken-shawarma-bowls","title":"Chicken Shawarma Bowls","tags":["main"],"totalMin":40,"costEstimate":14,"baseServings":6,"tier":"unplanned","lastPlanned":null,"timesPlanned":0,"daysUntilEligible":null,"rating":null},
 {"recipeId":"teriyaki","title":"Instant Pot Teriyaki Chicken","tags":["main","instant pot"],"totalMin":35,"costEstimate":12,"baseServings":8,"tier":"eligible","lastPlanned":"2026-06-17","timesPlanned":2,"daysUntilEligible":null,"rating":5},
 {"recipeId":"quickie-red-beans-and-rice","title":"Quickie Red Beans and Rice","tags":["main","quick"],"totalMin":30,"costEstimate":8,"baseServings":8,"tier":"eligible","lastPlanned":"2026-08-18","timesPlanned":1,"daysUntilEligible":null,"rating":4},
 {"recipeId":"butter-chicken","title":"Butter Chicken","tags":["main","instant pot"],"totalMin":45,"costEstimate":13,"baseServings":8,"tier":"eligible","lastPlanned":"2026-06-23","timesPlanned":1,"daysUntilEligible":null,"rating":2},
 {"recipeId":"baked-ziti","title":"Baked Ziti","tags":["main"],"totalMin":50,"costEstimate":10,"baseServings":8,"tier":"eligible","lastPlanned":"2026-07-10","timesPlanned":2,"daysUntilEligible":null,"rating":null},
 {"recipeId":"chicken-fajitas","title":"Chicken Fajitas","tags":["main","quick","sheet pan"],"totalMin":30,"costEstimate":12,"baseServings":8,"tier":"eligible","lastPlanned":"2026-07-28","timesPlanned":3,"daysUntilEligible":null,"rating":4},
 {"recipeId":"beef-stew","title":"Beef Stew","tags":["main","instant pot"],"totalMin":60,"costEstimate":16,"baseServings":8,"tier":"blocked","lastPlanned":"2026-09-15","timesPlanned":2,"daysUntilEligible":17,"rating":5},
 {"recipeId":"garlic-bread","title":"Garlic Bread","tags":["side"],"totalMin":15,"costEstimate":3,"baseServings":8,"tier":"eligible","lastPlanned":"2026-09-15","timesPlanned":4,"daysUntilEligible":null,"rating":null}
]}
