npm install html-minifier uglifycss webpack webpack-cli -g

html-minifier --collapse-whitespace --minify-css true --minify-js true homepage.html >homepage.min.html
mv homepage.min.html homepage.html
html-minifier --collapse-whitespace --minify-css true --minify-js true receive.html >receive.min.html
mv receive.min.html receive.html

uglifycss assets/homepage.css >assets/homepage.min.css
mv assets/homepage.min.css assets/homepage.css
uglifycss assets/receive.css >assets/receive.min.css
mv assets/receive.min.css assets/receive.css

webpack ./assets/homepage.js -o ./dist --mode production
mv dist/main.js assets/homepage.js
webpack ./assets/receive.js -o ./dist --mode production
mv dist/main.js assets/receive.js
webpack ./virtual-downloader.js -o ./dist --mode production
mv dist/main.js virtual-downloader.js
