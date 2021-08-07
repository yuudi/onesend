npm install html-minifier uglifycss uglify-js -g

html-minifier --collapse-whitespace --minify-css true --minify-js true homepage.html >homepage.min.html
mv homepage.min.html homepage.html
html-minifier --collapse-whitespace --minify-css true --minify-js true receive.html >receive.min.html
mv receive.min.html receive.html

uglifycss assets/homepage.css >assets/homepage.min.css
mv assets/homepage.min.css assets/homepage.css
uglifycss assets/receive.css >assets/receive.min.css
mv assets/receive.min.css assets/receive.css

uglifyjs assets/homepage.js >assets/homepage.min.js
mv assets/homepage.min.js assets/homepage.js
uglifyjs assets/receive.js >assets/receive.min.js
mv assets/receive.min.js assets/receive.js
uglifyjs assets/human-readable.js >assets/human-readable.min.js
mv assets/human-readable.min.js assets/human-readable.js
