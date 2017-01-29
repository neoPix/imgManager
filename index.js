const glob = require("glob");
const lwip = require("lwip");
const fs = require('fs');

function remove(path) {
	if(fs.existsSync(path)) {
		fs.unlinkSync(path);
	}
}

function cbToPromise (fn, ctx, ...args) {
	return new Promise((resolve, reject) => {
		args.push(function(err, obj){
			if(err) {
				reject(err);
			}
			else {
				resolve(obj);
			}
		});
		fn.apply(ctx, args);
	});
}

function processYieldable(it) {
	return new Promise((resolve, reject) => {
		function process() {
			let next = it.next();
			if(!next.done) {
				next.value.then(() => {
					process();
				}, err=> reject(err));
			}
			else {
				resolve();
			}
		}
		process();
	});
}

function *convertImage(files, config) {
	let processed = 0;
	for(const file of files) {
		let path = file.split('/');
		let name = path.pop();
		let ext = name.split('.').pop();
		path = path.join('/');

		processed ++;
		console.log(`Image : ${processed} / ${files.length}`);

		yield cbToPromise(lwip.open, lwip, file).then(img => {
			var promises = Object.keys(config)
			.filter(key => ['dir'].indexOf(key) === -1)
			.map(key => {
				const transform = config[key];
				return cbToPromise(img.clone, img).then(img => {
					let batch = img.batch();
					if(transform.operations) {
						Object.keys(transform.operations).forEach(operation => {
							batch = batch[operation].apply(batch, transform.operations[operation]);
						});
					}
					if(transform.maxWidth){
						let w = img.width();
						if(w > transform.maxWidth) {
							let ratio = transform.maxWidth / w;
							batch = batch.scale.apply(batch, [ratio, 'lanczos']);
						}
					}
					if(['jpg', 'jpeg'].indexOf(ext) >= 0) {
						return cbToPromise(batch.writeFile, batch, `${path}/${key}.${ext}`, {quality: transform.quality || 95});
					}
					else {
						return cbToPromise(batch.writeFile, batch, `${path}/${key}.${ext}`);
					}
				});
			});
			return Promise.all(promises);
		}, err => console.error(err));
	}
};

function *execConfigs(configs) {
	let processed = 0;
	for(config of configs) {
		processed ++;
		console.log(`Config : ${processed} / ${configs.length}`);
		yield cbToPromise(glob, null, `${config.dir}/**/base.*`, {}).then(images => {
			return processYieldable(convertImage(images, config));
		});
	}
}

// options is optional
cbToPromise(glob, null, '**/config.json', {}).then(files => {
	return files.map(file => {
		let parsed = JSON.parse(fs.readFileSync(file));
		parsed.dir = file.split('/');
		parsed.dir.pop();
		parsed.dir = parsed.dir.join('/');
		return parsed
	});
}).then(configs => processYieldable(execConfigs(configs)));