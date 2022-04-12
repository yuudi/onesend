npm install html-minifier uglifycss uglify-js -g

html-minifier --collapse-whitespace --minify-css true --minify-js true homepage.html >homepage.min.html
mv homepage.min.html homepage.html
html-minifier --collapse-whitespace --minify-css true --minify-js true history.html >history.min.html
mv history.min.html history.html
html-minifier --collapse-whitespace --minify-css true --minify-js true receive.html >receive.min.html
mv receive.min.html receive.html

uglifycss assets/homepage.css >assets/homepage.min.css
mv assets/homepage.min.css assets/homepage.css
uglifycss assets/history.css >assets/history.min.css
mv assets/history.min.css assets/history.css
uglifycss assets/receive.css >assets/receive.min.css
mv assets/receive.min.css assets/receive.css

uglifyjs assets/homepage.js >assets/homepage.min.js
mv assets/homepage.min.js assets/homepage.js
uglifyjs assets/history.js >assets/history.min.js
mv assets/history.min.js assets/history.js
uglifyjs assets/receive.js >assets/receive.min.js
mv assets/receive.min.js assets/receive.js
uglifyjs virtual-downloader.js >virtual-downloader.min.js
mv virtual-downloader.min.js virtual-downloader.js
