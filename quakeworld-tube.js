// three.js objects
var scene;
var camera;
var renderer;
var listener;

// mvd buffer
var mvd;

// mvd object arrays
var model_list;
var sound_list;
var sound_events;
var baseline;
var entities;

var mvd_time_curr = 0;
var mvd_time_prev = 0;
var render_time = 0;
var render_time_offset = -1;
var player_id;

// used to synchronize async loads
// easiest way to keep things in order
var load_count;

function qwtube_init() {
	THREE.Euler.DefaultOrder = "ZXY"; // FIXME?

	renderer = new THREE.WebGLRenderer({antialias: true});

	document.body.appendChild(renderer.domElement);
	renderer.setSize(window.innerWidth, window.innerHeight);

	window.addEventListener("resize", qwtube_resize);
	window.addEventListener("click", qwtube_switch_player);
	window.addEventListener('dragover', qwtube_dragover);
	window.addEventListener("drop", qwtube_load_mvd);
}

function qwtube_dragover(evt) {
	evt.stopPropagation();
	evt.preventDefault();
	evt.dataTransfer.dropEffect = 'copy';
}

function qwtube_play() {
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 1, 2000);
	listener = new THREE.AudioListener();
	camera.add(listener);

	scene.add(new THREE.AmbientLight(0xffffff));

	camera.up = new THREE.Vector3(0, 0, 1);
	camera.lookAt(new THREE.Vector3(1, 0, 0));
	camera.offset = new THREE.Euler().copy(camera.rotation);

	model_list = [];
	sound_list = [];
	sound_events = [];
	baseline = [];
	entities = [];

	player_id = -1;

	setTimeout(qwtube_parse_mvd());
}

function qwtube_resize() {
	if (!camera)
		return;
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize(window.innerWidth, window.innerHeight);
}

function qwtube_lerp_entities()
{
	var fac = 1.0 - (mvd_time_curr - render_time) / (mvd_time_curr - mvd_time_prev);

	entities.forEach(function(object) {
		if (object.position_curr.distanceTo(object.position_prev) < 200) {
			object.position.lerpVectors(object.position_prev, object.position_curr, fac);

			var prev = new THREE.Quaternion().setFromEuler(object.rotation_prev);
			var curr = new THREE.Quaternion().setFromEuler(object.rotation_curr);

			THREE.Quaternion.slerp(prev, curr, object.quaternion, fac);
		} else {
			object.position.copy(object.position_prev);
			object.rotation.copy(object.rotation_prev);
		}
	});
}

function qwtube_hover_entities() {
	entities.forEach(function(object) {
		switch (object.name) {
			case "armor":
			case "backpack":
			case "end1":
			case "end2":
			case "end3":
			case "end4":
			case "g_light":
			case "g_nail":
			case "g_nail2":
			case "g_rock":
			case "g_rock2":
			case "g_shot":
			case "invisibl":
			case "invulner":
			case "m_g_key":
			case "m_s_key":
			case "quaddama":
			case "suit":
			case "w_g_key":
			case "w_s_key":
				object.rotation.z += render_time * 0.002;
				object.position.z += 5 * Math.sin(render_time * 0.004);
			default:
		}
	});
}

function qwtube_switch_player() {
	if (!camera || camera.intermission)
		return;
	for (var i = player_id + 1; i < entities.length; i++) {
		if (entities[i] && entities[i].is_player) {
			if (player_id >= 0 && entities[player_id])
				scene.add(entities[player_id]);
			player_id = i;
			scene.remove(entities[player_id]);
			return;
		}
	}
	for (var i = 0; i < player_id; i++) {
		if (entities[i] && entities[i].is_player) {
			if (player_id >= 0 && entities[player_id])
				scene.add(entities[player_id]);
			player_id = i;
			scene.remove(entities[player_id]);
			return;
		}
	}
}

function qwtube_render(time) {
	requestAnimationFrame(qwtube_render);

	// for syncing render time to mvd time
	if (render_time_offset == -1)
		render_time_offset = time;
	render_time = time - render_time_offset;
	if (render_time == 0) // wait for first real frame because our parsing code is lazy
		return;

	if (render_time >= mvd_time_curr)
		qwtube_parse_mvd();

	qwtube_lerp_entities();
	qwtube_hover_entities();

	if (!entities[player_id])
		qwtube_switch_player();

	if (camera.intermission) {
		camera.position.copy(camera.intermission.position);
		camera.rotation.set(
			camera.offset.x - camera.intermission.rotation.x + 0.10 * Math.sin(render_time * 0.0005),
			camera.offset.y + camera.intermission.rotation.y + 0.05 * Math.sin(render_time * 0.0001),
			camera.offset.z + camera.intermission.rotation.z + 0.10 * Math.sin(render_time * 0.0010));
	} else {
		camera.position.copy(entities[player_id].position);
		camera.rotation.set(
			camera.offset.x - entities[player_id].rotation.x,
			camera.offset.y + entities[player_id].rotation.y,
			camera.offset.z + entities[player_id].rotation.z);
	}
	camera.position.z += 20;

	renderer.render(scene, camera);

	while (sound_events.length && render_time >= sound_events[0].time) {
		sound = sound_events.pop();
		if (sound_list[sound.id].isPlaying == true) {
				sound_list[sound.id].stop();
				sound_list[sound.id].isPlaying = false;
		}
		sound_list[sound.id].setVolume(sound.volume);
		sound_list[sound.id].position.copy(sound.position);
		sound_list[sound.id].updateMatrixWorld();
		sound_list[sound.id].play();
	}

	if (stats)
		stats.update();
}

function qwtube_load_map(map_name) {
	var mtl_name = map_name;
	if (map_name.charAt(0) == "*") {
		mtl_name = mvd.map_name;
		map_name = mvd.map_name + "_" + map_name.substring(1);
	}
	var map = new THREE.Group();
	var mtl_loader = new THREE.MTLLoader();
	mtl_loader.setTexturePath("maps/");
	mtl_loader.load("maps/" + mtl_name + ".mtl", function(materials) {
		materials.preload();
		var obj_loader = new THREE.OBJLoader();
		obj_loader.setMaterials(materials);
		obj_loader.load("maps/" + map_name + ".obj", function(object) {
			map.add(object);
			load_count--;
			console.log("map loaded: " + map.name);
		});
	});
	map.name = map_name;
	return map;
}

function qwtube_load_model(model_name) {
	var mtl_name = model_name;
	var model = new THREE.Group();

	switch (model_name) {
		case "s_bubble":
		case "s_explod":
		case "wizard":
		case "flame2":
		case "v_spike":
			model.add(new THREE.Mesh(new THREE.BoxGeometry(28, 28, 28), new THREE.MeshNormalMaterial()));
			load_count--;
			return model;
		default:
			break;
	}

	if (model_name == "armor") {
		load_count += 2;
		model.add(qwtube_load_model("armor_0"));
		model.add(qwtube_load_model("armor_1"));
		model.add(qwtube_load_model("armor_2"));
		model.name = model_name;
		return model;
	}

	if (model_name == "player") {
		load_count += 142;
		for (var i = 0; i < 143; i++)
			model.add(qwtube_load_model("player_" + i));
		model.name = model_name;
		return model;
	}

	if (model_name.startsWith("v_")) {
		mtl_name = model_name;
		model_name = model_name + "_0";
	}

	if (model_name.startsWith("player_")) {
		mtl_name = "player";
	}

	var mtl_loader = new THREE.MTLLoader();
	mtl_loader.setTexturePath("models/");
	mtl_loader.load("models/" + mtl_name + ".mtl", function(materials) {
		materials.preload();
		var obj_loader = new THREE.OBJLoader();
		obj_loader.setMaterials(materials);
		obj_loader.load("models/" + model_name + ".obj", function(object) {
			model.add(object);
			load_count--;
			console.log("model loaded: " + model.name);
		});
	});
	model.name = model_name;
	return model;
}

function qwtube_load_sound(sound_name) {
	var sound = new THREE.PositionalAudio(listener);
	var sound_loader = new THREE.AudioLoader();
	sound_loader.load("sound/" + sound_name, function(buffer) {
		sound.setBuffer(buffer);
		sound.name = sound_name;
		sound.setRefDistance(300);
		load_count--;
		console.log("sound loaded: " + sound.name);
	});
	// safari suspends the audio context by default
	if (sound.context.state == "suspended")
		sound.context.resume();
	return sound;
}

function qwtube_load_mvd(evt) {
	evt.stopPropagation();
	evt.preventDefault();
	var reader = new FileReader();
	reader.onload = function(event) {
		mvd = new DataView(event.target.result);
		mvd.size = event.total;
		mvd.offset = 0;
		mvd.msg_size = 0;
		console.log("mvd loaded: " + mvd.size + " bytes");
		qwtube_play();
	};
	reader.readAsArrayBuffer(evt.dataTransfer.files[0]);
}

function flush_string() {
	var string = "";

	while (mvd.getUint8(mvd.offset) != 0) {
		var val = mvd.getUint8(mvd.offset);

		if (val >= 18 && val <= 27) {
			val += 30;
		} else if (val >= 146 && val <= 155) {
			val -= 98;
		} else {
			val &= ~128;
		}

		string += String.fromCharCode(val);

		mvd.offset++;
		mvd.msg_size--;
	}

	mvd.offset++;
	mvd.msg_size--;

	return string;
}

function qwtube_parse_mvd() {
	var SVC_NOP                 =  1;
	var SVC_DISCONNECT          =  2;
	var SVC_UPDATESTAT          =  3;
	var SVC_SETVIEW             =  5;
	var SVC_SOUND               =  6;
	var SVC_PRINT               =  8;
	var SVC_STUFFTEXT           =  9;
	var SVC_SETANGLE            = 10;
	var SVC_SERVERDATA          = 11;
	var SVC_LIGHTSTYLE          = 12;
	var SVC_UPDATEFRAGS         = 14;
	var SVC_STOPSOUND           = 16;
	var SVC_DAMAGE              = 19;
	var SVC_SPAWNSTATIC         = 20;
	var SVC_SPAWNBASELINE       = 22;
	var SVC_TEMP_ENTITY         = 23;
	var SVC_SETPAUSE            = 24;
	var SVC_CENTERPRINT         = 26;
	var SVC_KILLEDMONSTER       = 27;
	var SVC_FOUNDSECRET         = 28;
	var SVC_SPAWNSTATICSOUND    = 29;
	var SVC_INTERMISSION        = 30;
	var SVC_FINALE              = 31;
	var SVC_CDTRACK             = 32;
	var SVC_SELLSCREEN          = 33;
	var SVC_SMALLKICK           = 34;
	var SVC_BIGKICK             = 35;
	var SVC_UPDATEPING          = 36;
	var SVC_UPDATEENTERTIME     = 37;
	var SVC_UPDATESTATLONG      = 38;
	var SVC_MUZZLEFLASH         = 39;
	var SVC_UPDATEUSERINFO      = 40;
	var SVC_DOWNLOAD            = 41;
	var SVC_PLAYERINFO          = 42;
	var SVC_CHOKECOUNT          = 44;
	var SVC_MODELLIST           = 45;
	var SVC_SOUNDLIST           = 46;
	var SVC_PACKETENTITIES      = 47;
	var SVC_DELTAPACKETENTITIES = 48;
	var SVC_MAXSPEED            = 49;
	var SVC_ENTGRAVITY          = 50;
	var SVC_SETINFO             = 51;
	var SVC_SERVERINFO          = 52;
	var SVC_UPDATEPL            = 53;
	var SVC_NAILS2              = 54;

	var DF_ORIGIN1     = (1 << 0);
	var DF_ORIGIN2     = (1 << 1);
	var DF_ORIGIN3     = (1 << 2);
	var DF_ANGLE1      = (1 << 3);
	var DF_ANGLE2      = (1 << 4);
	var DF_ANGLE3      = (1 << 5);
	var DF_EFFECTS     = (1 << 6);
	var DF_SKINNUM     = (1 << 7);
	var DF_WEAPONFRAME = (1 << 10);
	var DF_MODEL       = (1 << 11);

	var U_ANGLE1   = (1 << 0);
	var U_ANGLE3   = (1 << 1);
	var U_MODEL    = (1 << 2);
	var U_COLORMAP = (1 << 3);
	var U_SKIN     = (1 << 4);
	var U_EFFECTS  = (1 << 5);
	var U_ORIGIN1  = (1 << 9);
	var U_ORIGIN2  = (1 << 10);
	var U_ORIGIN3  = (1 << 11);
	var U_ANGLE2   = (1 << 12);
	var U_FRAME    = (1 << 13);
	var U_REMOVE   = (1 << 14);
	var U_MOREBITS = (1 << 15);

	var DEM_READ     = 1;
	var DEM_SET      = 2;
	var DEM_MULTIPLE = 3;
	var DEM_SINGLE   = 4;
	var DEM_STATS    = 5;
	var DEM_ALL      = 6;

	var TE_SPIKE          = 0;
	var TE_SUPERSPIKE     = 1;
	var TE_GUNSHOT        = 2;
	var TE_EXPLOSION      = 3;
	var TE_TAREXPLOSION   = 4;
	var TE_LIGHTNING1     = 5;
	var TE_LIGHTNING2     = 6;
	var TE_WIZSPIKE       = 7;
	var TE_KNIGHTSPIKE    = 8;
	var TE_LIGHTNING3     = 9;
	var TE_LAVASPLASH     = 10;
	var TE_TELEPORT       = 11;
	var TE_BLOOD          = 12;
	var TE_LIGHTNINGBLOOD = 13;

	while (true) {
		if (mvd.offset == mvd.byteLength) {
			return;
		}

		if (mvd.msg_size == 0) {
			var msg_delta = mvd.getUint8(mvd.offset);
			var msg_type = mvd.getUint8(mvd.offset + 1) & 0x07;

			if (render_time == 0 && msg_delta > 0) { // initial mvd info aquired. from here on reading is done by the render loop
				load_count = 1;
				sound_list[sound_list.length] = qwtube_load_sound("buttons/switch04.wav");

				var interval = setInterval(function() {
					if (load_count == 0) {
						clearInterval(interval);
						requestAnimationFrame(qwtube_render);
					}
				}, 100);

				return;
			}

			if (mvd_time_curr > render_time && msg_delta > 0) {
				return; // we have read up to the point we want to render
			}

			if (msg_delta > 0) {
				mvd_time_prev = mvd_time_curr;

				entities.forEach(function(object) {
					object.position_prev.copy(object.position_curr);
					object.rotation_prev.copy(object.rotation_curr);
				});
			}

			mvd_time_curr += msg_delta;
			mvd.offset += 2;

			if (msg_type == DEM_SET) {
				mvd.offset += 8;
				continue;
			}

			if (msg_type == DEM_MULTIPLE) {
				mvd.offset += 4;
			}

			mvd.msg_size = mvd.getUint32(mvd.offset, true);
			mvd.offset += 4;
		}

		var cmd = mvd.getUint8(mvd.offset);
		var id;
		var tmp;
		var string;

		mvd.offset++;
		mvd.msg_size--;

		var delta_source = -1;		

		switch (cmd) {
			case SVC_NOP:
				break;
			case SVC_DISCONNECT:
				flush_string();
				break;
			case SVC_UPDATESTAT:
				mvd.offset += 2;
				mvd.msg_size -= 2;
				break;
			case SVC_SETVIEW:
				break;
			case SVC_SOUND:
				var volume = 1.0;
				tmp = mvd.getUint16(mvd.offset, true);
				
				mvd.offset += 2;
				mvd.msg_size -= 2;
				
				if (tmp & (1 << 15)) { // vol
					volume = mvd.getUint8(mvd.offset) / 255;
				
					mvd.offset++;
					mvd.msg_size--;
				}
				
				if (tmp & (1 << 14)) { // attenuation
					mvd.offset++;
					mvd.msg_size--;
				}
				
				var sound_id = mvd.getUint8(mvd.offset);
				
				mvd.offset++;
				mvd.msg_size--;

				var position = new THREE.Vector3();

				position.x = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				position.y = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				position.z = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;	

				id = (tmp >> 3) & 1023; // entity
				tmp &= 7; // channel

				sound_events.push({id: sound_id, time: mvd_time_curr, volume: volume, position: position});

				break;
			case SVC_PRINT:
				tmp = mvd.getUint8(mvd.offset);
				
				mvd.offset++;
				mvd.msg_size--;
				
				string = flush_string();
				break;
			case SVC_STUFFTEXT:
				string = flush_string();

				if (string.startsWith("play ")) {
					tmp = string.trim().split(" ");
					for (var i = 1; i < sound_list.length; i++) {
						if (sound_list[i].name == tmp[1]) {
							var position = new THREE.Vector3().copy(camera.position);
							sound_events.push({id: i, time: mvd_time_curr, volume: 1.0, position: position});
							break;
						}
					}
				}

				break;
			case SVC_SETANGLE:
				mvd.offset += 4;
				mvd.msg_size -= 4;
				break;
			case SVC_SERVERDATA:
				mvd.offset += 8;
				mvd.msg_size -= 8;
				
				flush_string();
				
				mvd.offset += 4;
				mvd.msg_size -= 4;
				
				flush_string();
				
				mvd.offset += 40;
				mvd.msg_size -= 40;
				break;
			case SVC_LIGHTSTYLE:
				mvd.offset++;
				mvd.msg_size--;
				
				flush_string();
				break;
			case SVC_UPDATEFRAGS:
				id = mvd.getUint8(mvd.offset);
				
				mvd.offset++;
				mvd.msg_size--;
				
				/*player[id].frags =*/ mvd.getInt16(mvd.offset, true);
				
				mvd.offset += 2;
				mvd.msg_size -= 2;
				
			//	this.team_scores();
				break;
			case SVC_STOPSOUND:
				mvd.offset += 2;
				mvd.msg_size -= 2;
				break;
			case SVC_DAMAGE:
				mvd.offset += 8;
				mvd.msg_size -= 8;
				break;
			case SVC_SPAWNSTATIC:
				id = mvd.getUint8(mvd.offset);

				mvd.offset++;
				mvd.msg_size--;

				var tmp = model_list[id];

				scene.add(tmp);

				mvd.offset += 3;
				mvd.msg_size -= 3;

				tmp.position.x = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				tmp.rotation.x = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;

				mvd.offset++;
				mvd.msg_size--;

				tmp.position.y = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				tmp.rotation.y = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;

				mvd.offset++;
				mvd.msg_size--;

				tmp.position.z = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				tmp.rotation.z = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;

				mvd.offset++;
				mvd.msg_size--;
				break;
			case SVC_SPAWNBASELINE:
				id = mvd.getUint16(mvd.offset, true);

				mvd.offset += 2;
				mvd.msg_size -= 2;

				tmp = mvd.getUint8(mvd.offset);

				mvd.offset++;
				mvd.msg_size--;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				var skin = mvd.getUint8(mvd.offset);

				if (id == 0) {
					baseline[id] = model_list[tmp];
					scene.add(model_list[tmp]);
				} else if (model_list[tmp].name == "armor") {
					baseline[id] = model_list[tmp].children[skin].clone();
					baseline[id].name = "armor";
				} else {
					baseline[id] = model_list[tmp].clone();
				}

				mvd.offset++;
				mvd.msg_size--;

				baseline[id].position.x = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				baseline[id].rotation.x = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;

				mvd.offset++;
				mvd.msg_size--;

				baseline[id].position.y = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				baseline[id].rotation.y = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;

				mvd.offset++;
				mvd.msg_size--;

				baseline[id].position.z = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				baseline[id].rotation.z = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;

				mvd.offset++;
				mvd.msg_size--;

				break;
			case SVC_TEMP_ENTITY:
				id = mvd.getUint8(mvd.offset);

				mvd.offset++;
				mvd.msg_size--;

				if (id == TE_LIGHTNING1 || id == TE_LIGHTNING2 || id== TE_LIGHTNING3) {
					// entity type
					mvd.getInt16(mvd.offset, true);

					mvd.offset += 2;
					mvd.msg_size -= 2;

					// pos
					mvd.getInt16(mvd.offset, true) / 8;

					mvd.offset += 2;
					mvd.msg_size -= 2;

					mvd.getInt16(mvd.offset, true) / 8;

					mvd.offset += 2;
					mvd.msg_size -= 2;

					mvd.getInt16(mvd.offset, true) / 8;

					mvd.offset += 2;
					mvd.msg_size -= 2;

					// origin pos
					mvd.getInt16(mvd.offset, true) / 8;

					mvd.offset += 2;
					mvd.msg_size -= 2;

					mvd.getInt16(mvd.offset, true) / 8;

					mvd.offset += 2;
					mvd.msg_size -= 2;

					mvd.getInt16(mvd.offset, true) / 8;
					
					mvd.offset += 2;
					mvd.msg_size -= 2;
				} else {
					if (id == TE_GUNSHOT || id == TE_BLOOD) {
						mvd.getInt8(mvd.offset);

						mvd.offset++;
						mvd.msg_size--;
					}

					// pos
					mvd.getInt16(mvd.offset, true) / 8;

					mvd.offset += 2;
					mvd.msg_size -= 2;

					mvd.getInt16(mvd.offset, true) / 8;

					mvd.offset += 2;
					mvd.msg_size -= 2;

					mvd.getInt16(mvd.offset, true) / 8;

					mvd.offset += 2;
					mvd.msg_size -= 2;
				}
				break;
			case SVC_SETPAUSE:
				break;
			case SVC_CENTERPRINT:
				flush_string();
				break;
			case SVC_KILLEDMONSTER:
				break;
			case SVC_FOUNDSECRET:
				break;
			case SVC_SPAWNSTATICSOUND:
				var position = new THREE.Vector3();

				position.x = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				position.y = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				position.z = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				id = mvd.getUint8(mvd.offset);

				mvd.offset++;
				mvd.msg_size--;

				var volume = mvd.getUint8(mvd.offset) / 255;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				if (sound_list[id].isPlaying == true)
				{
						sound_list[id].stop();
						sound_list[id].isPlaying = false;
				}
				sound_list[id].setVolume(volume);
				sound_list[id].setLoop(true);
				sound_list[id].position.copy(position);
				sound_list[id].updateMatrixWorld();
				sound_list[id].play();
				break;
			case SVC_INTERMISSION:
				camera.intermission = { position: new THREE.Vector3(), rotation: new THREE.Euler() };

				camera.intermission.position.x = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				camera.intermission.position.y = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				camera.intermission.position.z = mvd.getInt16(mvd.offset, true) / 8;

				mvd.offset += 2;
				mvd.msg_size -= 2;

				camera.intermission.rotation.x = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;

				mvd.offset++;
				mvd.msg_size--;

				camera.intermission.rotation.z = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;

				mvd.offset++;
				mvd.msg_size--;

				camera.intermission.rotation.y = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;

				mvd.offset++;
				mvd.msg_size--;

				entities.forEach(function(object) {
					if (object.is_player)
						scene.remove(object);
				});

				break;
			case SVC_FINALE:
				break;
			case SVC_CDTRACK:
				tmp = mvd.getUint8(mvd.offset);

				mvd.offset++;
				mvd.msg_size--;

				break;
			case SVC_SELLSCREEN:
				break;
			case SVC_SMALLKICK:
				break;
			case SVC_BIGKICK:
				break;
			case SVC_UPDATEPING:
				id = mvd.getUint8(mvd.offset);
				
				mvd.offset++;
				mvd.msg_size--;
				
				/*player[id].ping = */mvd.getUint16(mvd.offset, true);
				
				mvd.offset += 2;
				mvd.msg_size -= 2;
				break;
			case SVC_UPDATEENTERTIME:
				mvd.offset += 5;
				mvd.msg_size -= 5;
				break;
			case SVC_UPDATESTATLONG:
				mvd.offset += 5;
				mvd.msg_size -= 5;
				break;
			case SVC_MUZZLEFLASH:
				mvd.offset += 2;
				mvd.msg_size -= 2;
				break;
			case SVC_UPDATEUSERINFO:
				id = mvd.getUint8(mvd.offset) + 1;

				mvd.offset += 5
				mvd.msg_size -= 5;

				baseline[id].name = "";
				baseline[id].team = "";
				baseline[id].spec = 0;

				entities[id] = baseline[id].children[0].clone();

				entities[id].position_curr = new THREE.Vector3();
				entities[id].rotation_curr = new THREE.Euler();

				entities[id].position_prev = new THREE.Vector3();
				entities[id].rotation_prev = new THREE.Euler();

				string = flush_string();
				if (string.length) {
					tmp = string.split("\\");
					
					for (var i = 1; i < tmp.length; i += 2) {
						switch (tmp[i]) {
							case "name":
								baseline[id].name = tmp[i + 1];
								break;
							case "team":
								baseline[id].team = tmp[i + 1];
								break;
							case "*spectator":
								baseline[id].spec = tmp[i + 1];
								break;
							default:
								break;
						}
					}
				}
				
				if (baseline[id].name.length > 0 && baseline[id].spec == 0) {
					scene.add(entities[id]);
					entities[id].is_player = true;
				}
				break;
			case SVC_DOWNLOAD:
				break;
			case SVC_PLAYERINFO:
				id = mvd.getUint8(mvd.offset) + 1;
				
				mvd.offset++;
				mvd.msg_size--;
				
				tmp = mvd.getUint16(mvd.offset, true);
				
				mvd.offset += 3;
				mvd.msg_size -= 3;
				
				if (tmp & DF_ORIGIN1) {
					entities[id].position_curr.x = mvd.getInt16(mvd.offset, true) / 8;
					
					mvd.offset += 2;
					mvd.msg_size -= 2;
				}
				
				if (tmp & DF_ORIGIN2) {
					entities[id].position_curr.y = mvd.getInt16(mvd.offset, true) / 8;
					
					mvd.offset += 2;
					mvd.msg_size -=2;
				}
				
				if (tmp & DF_ORIGIN3) {
					entities[id].position_curr.z = mvd.getInt16(mvd.offset, true) / 8;
					
					mvd.offset += 2;
					mvd.msg_size -= 2;
				}
				
				if (tmp & DF_ANGLE1) {
					entities[id].rotation_curr.x = (360 * mvd.getUint16(mvd.offset, true) / 65536) * Math.PI / 180;
					
					mvd.offset += 2;
					mvd.msg_size -= 2;
				}
				
				if (tmp & DF_ANGLE2) {
					entities[id].rotation_curr.z = (360 * mvd.getUint16(mvd.offset, true) / 65536) * Math.PI / 180;
					
					mvd.offset += 2;
					mvd.msg_size -= 2;
				}
				
				if (tmp & DF_ANGLE3) {
					entities[id].rotation_curr.y = (360 * mvd.getUint16(mvd.offset, true) / 65536) * Math.PI / 180;
					
					mvd.offset += 2;
					mvd.msg_size -= 2;
				}
				
				if (tmp & DF_MODEL) {
					mvd.offset++;
					mvd.msg_size--;
				}
				
				if (tmp & DF_SKINNUM) {
					mvd.offset++;
					mvd.msg_size--;
				}
				
				if (tmp & DF_EFFECTS) {
					mvd.offset++;
					mvd.msg_size--;
				}
				
				if (tmp & DF_WEAPONFRAME) {
					mvd.offset++;
					mvd.msg_size--;
				}
				break;
			case SVC_CHOKECOUNT:
				mvd.offset++;
				mvd.msg_size--;
				break;
			case SVC_MODELLIST:
				tmp = mvd.getUint8(mvd.offset);

				mvd.offset++;
				mvd.msg_size--;

				var models = [];

				while (mvd.getUint8(mvd.offset) != 0) {
					models.push(flush_string().replace(/^.*\/|\.[^.]*$/g, ""));
				}

				mvd.offset += 2;
				mvd.msg_size -= 2;

				load_count = models.length;

				models.forEach(function(model_name) {
					if (tmp == 0 || model_name.charAt(0) == "*") {
						if (tmp == 0) {
							mvd.map_name = model_name;
						}
						model_list[++tmp] = qwtube_load_map(model_name);
					} else {
						model_list[++tmp] = qwtube_load_model(model_name);
					}
				});

				var interval = setInterval(function() {
					if (load_count == 0) {
						clearInterval(interval);
						qwtube_parse_mvd();
					}
				}, 100);

				return;
			case SVC_SOUNDLIST:
				tmp = mvd.getUint8(mvd.offset);

				mvd.offset++;
				mvd.msg_size--;
				
				var sounds = [];
				
				while (mvd.getUint8(mvd.offset) != 0) {
					sounds.push(flush_string());
				}

				mvd.offset += 2;
				mvd.msg_size -= 2;
				
				load_count = sounds.length;

				sounds.forEach(function(sound_name) {
					sound_list[++tmp] = qwtube_load_sound(sound_name);
				});

				var interval = setInterval(function() {
					if (load_count == 0) {
						clearInterval(interval);
						qwtube_parse_mvd();
					}
				}, 100);
				
				return;
			case SVC_DELTAPACKETENTITIES:
				delta_source = mvd.getUint8(mvd.offset);

				mvd.offset++;
				mvd.msg_size--;
			case SVC_PACKETENTITIES:
				while (true) {
					var fix_lerp = 0;
					tmp = mvd.getUint16(mvd.offset, true);
					
					mvd.offset += 2;
					mvd.msg_size -= 2;
					
					if (!tmp)
						break;
					
					id = tmp & 0x1ff;
					tmp &= ~0x1ff;
					
					if (!entities[id] && baseline[id]) {
						fix_lerp = 1;

						if (baseline[id].children.length > 1)
							entities[id] = baseline[id].children[0].clone();
						else
							entities[id] = baseline[id].clone();

						entities[id].position_curr = new THREE.Vector3();
						entities[id].rotation_curr = new THREE.Euler();

						entities[id].position_prev = new THREE.Vector3();
						entities[id].rotation_prev = new THREE.Euler();

						entities[id].position_curr.copy(baseline[id].position);
						entities[id].rotation_curr.copy(baseline[id].rotation);

						scene.add(entities[id]);
					}
					
					if (tmp & U_MOREBITS) {
						tmp |= mvd.getUint8(mvd.offset);
						
						mvd.offset++;
						mvd.msg_size--;
					}
					
					if (tmp & U_REMOVE) {
						scene.remove(entities[id]);
						delete entities[id];
					}
					
					if (tmp & U_MODEL) {
						var idx = mvd.getUint8(mvd.offset);
						
						mvd.offset++;
						mvd.msg_size--;
						
						if (entities[id]) {
							scene.remove(entities[id]);
							delete entities[id];
						}

						fix_lerp = 1;						

						if (model_list[idx].children.length > 1)
							entities[id] = model_list[idx].children[0].clone();
						else
							entities[id] = model_list[idx].clone();

						entities[id].position_curr = new THREE.Vector3();
						entities[id].rotation_curr = new THREE.Euler();

						entities[id].position_prev = new THREE.Vector3();
						entities[id].rotation_prev = new THREE.Euler();

						scene.add(entities[id]);
					}
					
					if (tmp & U_FRAME) {
						var idx = mvd.getUint8(mvd.offset);
						var i;

						for (i = 0; i < model_list.length; i++)
							if (model_list[i] && model_list[i].name == "player")
								break;

						entities[id].remove(entities[id].children[0])
						entities[id].add(model_list[i].children[idx].clone());

						mvd.offset++;
						mvd.msg_size--;
					}
					
					if (tmp & U_COLORMAP) {
						mvd.offset++;
						mvd.msg_size--;
					}
					
					if (tmp & U_SKIN) {
						mvd.offset++;
						mvd.msg_size--;
					}
					
					if (tmp & U_EFFECTS) {
						mvd.offset++;
						mvd.msg_size--;
					}
					
					if (tmp & U_ORIGIN1) {
						entities[id].position_curr.x = mvd.getInt16(mvd.offset, true) / 8;
						
						mvd.offset += 2;
						mvd.msg_size -= 2;
					}
					
					if (tmp & U_ANGLE1) {
						entities[id].rotation_curr.x = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;
						
						mvd.offset++;
						mvd.msg_size--;
					}
					
					if (tmp & U_ORIGIN2) {
						entities[id].position_curr.y = mvd.getInt16(mvd.offset, true) / 8;
						
						mvd.offset += 2;
						mvd.msg_size -= 2;
					}
					
					if (tmp & U_ANGLE2) {
						entities[id].rotation_curr.z = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;
						
						mvd.offset++;
						mvd.msg_size--;
					}
					
					if (tmp & U_ORIGIN3) {
						entities[id].position_curr.z = mvd.getInt16(mvd.offset, true) / 8;
						
						mvd.offset += 2;
						mvd.msg_size -= 2;
					}
					
					if (tmp & U_ANGLE3) {
						entities[id].rotation_curr.y = (360 * mvd.getUint8(mvd.offset) / 256) * Math.PI / 180;
						
						mvd.offset++;
						mvd.msg_size--;
					}

					if (fix_lerp) {
						entities[id].position_prev.copy(entities[id].position_curr);
						entities[id].rotation_prev.copy(entities[id].rotation_curr);
					}
				}
				break;
			case SVC_MAXSPEED:
				mvd.offset += 4;
				mvd.msg_size -= 4;
				break;
			case SVC_ENTGRAVITY:
				break;
			case SVC_SETINFO:
				mvd.offset++;
				mvd.msg_size--;
				
				flush_string();
				flush_string();
				break;
			case SVC_SERVERINFO:
				flush_string();
				flush_string();
				break;
			case SVC_UPDATEPL:
				id = mvd.getUint8(mvd.offset);
				
				mvd.offset++;
				mvd.msg_size--;
				
			/*	player[id].pl =*/ mvd.getUint8(mvd.offset);
				
				mvd.offset++;
				mvd.msg_size--;
				break;
			case SVC_NAILS2:
				tmp = mvd.getUint8(mvd.offset);
				
				mvd.offset += 7 * tmp;
				mvd.msg_size -= 7 * tmp;
				break;
			default:
				console.log("mvd parse error");
				alert("mvd parse error");
				return;
		}
	}
}
