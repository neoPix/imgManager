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

function transformImage (file, transform, path, ext) {
	return cbToPromise(lwip.open, lwip, file).then(img => {
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
			return cbToPromise(batch.writeFile, batch, `${path}/${transform.name}.${ext}`, {quality: transform.quality || 95});
		}
		else {
			return cbToPromise(batch.writeFile, batch, `${path}/${transform.name}.${ext}`);
		}
	});	
}

function *transformImages(keys, img, path, ext) {
	for(key of keys) {
		yield transformImage(img, key, path, ext).then(res => res, err => {
			console.error(img, key, err);
			return true;
		});
	}
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

		let keys = Object.keys(config)
		.filter(key => ['dir'].indexOf(key) === -1)
		.map(key => {
			config[key].name = key;
			return config[key]
		});

		yield processYieldable(transformImages(keys, file, path, ext));
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
}).then(configs => processYieldable(execConfigs(configs))).catch(err => console.error(err));