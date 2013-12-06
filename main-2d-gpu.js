/*
sources:
http://www.mpia.de/homes/dullemon/lectures/fluiddynamics/
http://www.cfdbooks.com/cfdcodes.html
"Riemann Solvers and Numerical Methods for Fluid Dynamics," Toro
http://people.nas.nasa.gov/~pulliam/Classes/New_notes/euler_notes.pdf also does not
*/

var panel;
var canvas;

var xmin = -.5;
var xmax = .5; 
var ymin = -.5;
var ymax = .5;

var useNoise = true;
var noiseAmplitude = .01;

var useCFL = false;
var fixedDT = .00025;

var mouse;

var fbo;
var FloatTexture2D;

var quadVtxBuf, quadObj;

var drawToScreenShader = {};

var kernelVertexShader;

var solidShader;
var copyShader;

var resetSodShader;
var resetWaveShader;
var resetKelvinHemholtzShader;

var computePressureShader;
var applyPressureToMomentumShader;

var burgersComputeInterfaceVelocityShader;
var burgersComputeFluxSlopeShader = [];	//[side]
var burgersComputeFluxShader = {};		//[fluxMethod][side]
var burgersUpdateStateShader;

var roeComputeRoeValueShader = [];	//[side] = [velocity.x, velocity.y, hTotal, speedOfSound]
var roeComputeEigenvalueShader = [];		//[side]
var roeComputeEigenvectorColumnShader = [];	//[side][column state]
var roeComputeEigenvectorInverseColumnShader = [];	//[side][column state]
var roeComputeJacobianColumnShader = [];	//[side][column state]
var roeComputeDeltaQTildeShader = [];	//[side]
var roeComputeFluxSlopeShader = [];	//[side]
var roeComputeFluxShader = {};	//[fluxMethod][side]
var roeUpdateStateShader;

var encodeTempTex;
var encodeShader = [];	//[channel]

//coordinate names
var coordNames = ['x', 'y'];

var drawToScreenMethods = {
	Density : 'return texture2D(qTex, pos).x;',
	Velocity : 'vec4 q = texture2D(qTex, pos); return length(q.yz) / q.x;',
	Energy : 'return texture2D(qTex, pos).w;',
	//P = (gamma - 1) rho (eTotal - eKinetic)
	Pressure : 'return texture2D(pressureTex, pos).x;',
	Curl : 'vec4 q = texture2D(qTex, pos); return (dFdy(q.y) - dFdx(q.z)) / q.w;'
};

var fluxMethods = {
	'donor cell' : 'return vec4(0.);',
	'Lax-Wendroff' : 'return vec4(1.);',
	'Beam-Warming' : 'return r;',
	'Fromm' : 'return .5 * (1. + r);',
/*
	//Wikipedia
	//CHARM : function(r) { return Math.max(0, r*(3*r+1)/((r+1)*(r+1)) ); },
	//HCUS : function(r) { return Math.max(0, 1.5 * (r + Math.abs(r)) / (r + 2) ); },
	//HQUICK : function(r) { return Math.max(0, 2 * (r + Math.abs(r)) / (r + 3) ); },
	//Koren : function(r) { return Math.max(0, Math.min(2*r, (1 + 2*r)/3 ,2) ); },
	//minmod : function(r) { return Math.max(0, Math.min(r,1) ); },
	//Oshker : function(r) { return Math.max(0, Math.min(r,1.5) ); },	//replace 1.5 with 1 <= beta <= 2	
	//ospre : function(r) { return .5 * (r*r + r) / (r*r + r + 1); },
	//smart : function(r) { return Math.max(0, Math.min(2 * r, .25 + .75 * r, 4)); },
	//Sweby : function(r) { return Math.max(0, Math.min(1.5 * r, 1), Math.min(r, 1.5)); },	//replace 1.5 with 1 <= beta <= 2
	//UMIST : function(r) { return Math.max(0, Math.min(2*r, .75 + .25*r, .25 + .75*r, 2)); },	
	//'van Albada 1' : function(r) { return (r * r + r) / (r * r + 1); },
	//'van Albada 2' : function(r) { return 2 * r / (r * r + 1); },
*/	
	'van Leer' : 'return (r + abs(r)) / (1. + abs(r));', 
	'monotonized central' : 'return max(vec4(0.), min(vec4(2.), min(.5 * (1. + r), 2. * r)));',
	superbee : 'return max(vec4(0.), max(min(vec4(1.), 2. * r), min(vec4(2.), r)));'
};

var boundaryMethods = {
	periodic : function() {
		//set all lookup texture wraps to REPEAT
		$.each([
			this.qTex,
			this.nextQTex,
			this.pressureTex,
			this.fluxTex[0],
			this.fluxTex[1],
			this.rTex[0],
			this.rTex[1],
			this.uiTex
		], function(i, tex) {
			tex.bind();
			tex.setWrap({s : gl.REPEAT, t : gl.REPEAT});
		});
	},
	/*
	mirror : function(nx,q) {
		//TODO set all lookup texture wraps to REPEAT_MIRROR 
		//or better yet, construct a boundary texture, and instead of "mirror boundary" just change that tex to have solid left and bottom values
	},
	dirichlet : function() {
		//TODO set all lookup texture wraps to ... zero?
	},
	*/
	constant : function(nx,q) {
		//TODO set all lookup texture wraps to ... CLAMP
		$.each([
			this.qTex,
			this.nextQTex,
			this.pressureTex,
			this.fluxTex[0],
			this.fluxTex[1],
			this.rTex[0],
			this.rTex[1],
			this.uiTex
		], function(i, tex) {
			tex.bind();
			tex.setWrap({s : gl.CLAMP_TO_EDGE, t : gl.CLAMP_TO_EDGE});
		});
	}
};

//called with 'this' the HydroState
var advectMethods = {
	Burgers : {
		initStep : function() {
			//TODO reduce to determien CFL
		},
		calcCFLTimestep : function() {
			//TODO
		},	
		advect : function(dt) {			
			var dx = (xmax - xmin) / this.nx;
			var dy = (ymax - ymin) / this.nx;
			var dxi = [dx, dy];
			
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.uiTex.obj, 0);
			fbo.check();
			//get velocity at interfaces from state
			quadObj.draw({
				shader : burgersComputeInterfaceVelocityShader,
				texs : [this.qTex]
			});

			for (var side = 0; side < 2; ++side) {
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rTex[side].obj, 0);
				fbo.check();
				quadObj.draw({
					shader : burgersComputeFluxSlopeShader[side],
					texs : [
						this.qTex, 
						this.uiTex
					]
				});
			}

			//construct flux:
			for (var side = 0; side < 2; ++side) {
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fluxTex[side].obj, 0);
				fbo.check();
				quadObj.draw({
					shader : burgersComputeFluxShader[this.fluxMethod][side],
					uniforms : {
						dt_dx : dt / dxi[side]
					},
					texs : [
						this.qTex,
						this.uiTex,
						this.rTex[side]
					]
				});
			}

			//update state
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.nextQTex.obj, 0);
			fbo.check();
			quadObj.draw({
				shader : burgersUpdateStateShader,
				uniforms : {
					dt_dx : [
						dt / dx,
						dt / dy
					]
				},
				texs : [
					this.qTex, 
					this.fluxTex[0], 
					this.fluxTex[1]
				]
			});
			this.swapQTexs();
		}
	},
	'Riemann / Roe' : {
		initStep : function() {
			for (var side = 0; side < 2; ++side) {
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.roeValueTex[side].obj, 0);
				fbo.check();
				quadObj.draw({
					shader : roeComputeRoeValueShader[side],
					texs : [this.qTex]
				});
			
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.eigenvalueTex[side].obj, 0);
				fbo.check();
				quadObj.draw({
					shader : roeComputeEigenvalueShader[side],
					texs : [this.qTex, this.roeValueTex[side]]
				});

				for (var column = 0; column < 4; ++column) {
					gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.eigenvectorColumnTex[side][column].obj, 0);
					fbo.check();
					quadObj.draw({
						shader : roeComputeEigenvectorColumnShader[side][column],
						texs : [this.qTex, this.roeValueTex[side]]
					});
				}

				for (var column = 0; column < 4; ++column) {
					gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.eigenvectorInverseColumnTex[side][column].obj, 0);
					fbo.check();
					quadObj.draw({
						shader : roeComputeEigenvectorInverseColumnShader[side][column],
						texs : [this.qTex, this.roeValueTex[side]]
					});
				}

				for (var column = 0; column < 4; ++column) {
					gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.jacobianColumnTex[side][column].obj, 0);
					fbo.check();
					quadObj.draw({
						shader : roeComputeJacobianColumnShader[side][column],
						texs : [this.qTex, this.roeValueTex[side]]
					});
				}
			}
		},
		calcCFLTimestep : function() {
			//TODO reduce to determine CFL
		},
		advect : function(dt) {
			var dx = (xmax - xmin) / this.nx;
			var dy = (ymax - ymin) / this.nx;
			var dxi = [dx, dy];
			
			for (var side = 0; side < 2; ++side) {
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.dqTildeTex[side].obj, 0);
				fbo.check();
				quadObj.draw({
					shader : roeComputeDeltaQTildeShader[side],
					texs : [
						this.qTex, 
						this.eigenvectorInverseColumnTex[side][0],
						this.eigenvectorInverseColumnTex[side][1],
						this.eigenvectorInverseColumnTex[side][2],
						this.eigenvectorInverseColumnTex[side][3]
					]
				});
			}

			for (var side = 0; side < 2; ++side) {
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rTildeTex[side].obj, 0);
				fbo.check();
				quadObj.draw({
					shader : roeComputeFluxSlopeShader[side],
					texs : [
						this.dqTildeTex[side],
						this.eigenvalueTex[side]
					]
				});
			}
	
			for (var side = 0; side < 2; ++side) {
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fluxTex[side].obj, 0);
				fbo.check();
				quadObj.draw({
					shader : roeComputeFluxShader[this.fluxMethod][side],
					uniforms : {
						dt_dx : dt / dxi[side]
					},
					texs : [
						this.qTex,
						this.dqTildeTex[side],
						this.rTildeTex[side],
						this.eigenvalueTex[side],
						this.eigenvectorInverseColumnTex[side][0],
						this.eigenvectorInverseColumnTex[side][1],
						this.eigenvectorInverseColumnTex[side][2],
						this.eigenvectorInverseColumnTex[side][3],
						this.eigenvectorColumnTex[side][0],
						this.eigenvectorColumnTex[side][1],
						this.eigenvectorColumnTex[side][2],
						this.eigenvectorColumnTex[side][3]
					]
				});
			}

			//update state
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.nextQTex.obj, 0);
			fbo.check();
			quadObj.draw({
				shader : burgersUpdateStateShader,
				uniforms : {
					dt_dx : [
						dt / dx,
						dt / dy
					]
				},
				texs : [
					this.qTex, 
					this.fluxTex[0], 
					this.fluxTex[1]
				]
			});
			this.swapQTexs();
		}
	}
};

var HydroState = makeClass({ 
	init : function(args) {
		var thiz = this;

		this.nx = args.size;
		this.cfl =.5;
		this.gamma = args.gamma;

		var dpos = [1/this.nx, 1/this.nx];
		
		//provide default dpos values to shaders
		var shaders = [];

		//burgers
		shaders.push(burgersComputeInterfaceVelocityShader);
		shaders = shaders.concat(burgersComputeFluxSlopeShader);	
		$.each(burgersComputeFluxShader, function(k, fluxShaders) {
			shaders = shaders.concat(fluxShaders);
		});
		shaders.push(burgersUpdateStateShader);
	
		//riemann /roe
		shaders = shaders.concat(roeComputeRoeValueShader);
		shaders = shaders.concat(roeComputeEigenvalueShader);
		$.each(roeComputeEigenvectorColumnShader, function(k, evShaders) {
			shaders = shaders.concat(evShaders);
		});
		$.each(roeComputeEigenvectorInverseColumnShader, function(k, evInvShaders) {
			shaders = shaders.concat(evInvShaders);
		});
		$.each(roeComputeJacobianColumnShader, function(k, jShaders) {
			shaders = shaders.concat(jShaders);
		});
		shaders = shaders.concat(roeComputeDeltaQTildeShader);
		shaders = shaders.concat(roeComputeFluxSlopeShader);
		$.each(roeComputeFluxShader, function(k, fluxShaders) {
			shaders = shaders.concat(fluxShaders);
		});
		shaders.push(roeUpdateStateShader);

		//common to both
		shaders.push(computePressureShader);
		shaders.push(applyPressureToMomentumShader);
		shaders.push(applyPressureToWorkShader);

		//display
		$.each(drawToScreenShader, function(k, drawShader) {
			shaders.push(drawShader);
		});

		$.each(shaders, function(i,shader) {
			shader
				.use()
				.setUniforms({
					dpos : dpos,
					gamma : thiz.gamma
				})
				.useNone();
		});

		//http://lab.concord.org/experiments/webgl-gpgpu/webgl.html
		encodeTempTex = new GL.Texture2D({
			internalFormat : gl.RGBA,
			format : gl.RGBA,
			type : gl.UNSIGNED_BYTE,
			width : this.nx,
			height : this.nx,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			}
		});

		this.noiseTex = new GL.Texture2D({
			internalFormat : gl.RGBA,
			format : gl.RGBA,
			type : gl.FLOAT,
			width : this.nx,
			height : this.nx,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			},
			data : function(i,j) {
				return [
					Math.random(),
					Math.random(),
					Math.random(),
					Math.random()
				];
			}
		});

		//I'm skipping on x_i,j
		//Instead just use the uniforms xmin, xmax, ymin, ymax

		//I'm skipping on x_{i-1/2,j-1/2} because 
		//(1) you can reconstruct it from x
		//(2) it is only used for calculating dx's
		
		//q_i,j,state: state vector, stored as q[state + 4 * (j + this.nx * i)]
		//q_i,j,0: density: rho
		//q_i,j,1: momentum: rho * u
		//q_i,j,2: momentum: rho * v
		//q_i,j,3: work: rho * e
		this.qTex = new FloatTexture2D(this.nx, this.nx);	//rho, rho * u, rho * v, rho * e
		this.nextQTex = new FloatTexture2D(this.nx, this.nx);	//rho, rho * u, rho * v, rho * e

		this.resetSod();
		
		//p_i,j: pressure
		this.pressureTex = new FloatTexture2D(this.nx, this.nx);

		//TODO it is tempting to merge r, f, and ui into an edge structure
		//and associate them with the nodes on either side of them,
		//but then I would lose out on the 2nd-order contributions to the flux limiter.

		//f_{i-1/2},{j-1/2},side,state: cell flux
		this.fluxTex = [];
		for (var side = 0; side < 2; ++side) {
			this.fluxTex[side] = new FloatTexture2D(this.nx, this.nx);
		}


		//used for Burgers
		
		
		//r_{i-1/2},{j-1/2},side,state	
		this.rTex = [];
		for (var side = 0; side < 2; ++side) {
			this.rTex[side] = new FloatTexture2D(this.nx, this.nx);
		}
		
		//only used with Burger's eqn advection code
		//u_{i-1/2},{j-1/2},dim: interface velocity
		this.uiTex = new FloatTexture2D(this.nx, this.nx);


		//used for Riemann
	

		//v_{i-1/2},{j-1/2},side = [velocity.x, velocity.y, hTotal, speedOfSound]
		this.roeValueTex = [];
		for (var side = 0; side < 2; ++side) {
			this.roeValueTex[side] = new FloatTexture2D(this.nx, this.nx);
		}

		//a_{i-1/2},{j-1/2},side,state,state
		this.eigenvalueTex  = [];
		for (var side = 0; side < 2; ++side) {
			this.eigenvalueTex[side] = new FloatTexture2D(this.nx, this.nx); 
		}
		this.eigenvectorColumnTex = [];
		for (var side = 0; side < 2; ++side) {
			this.eigenvectorColumnTex[side] = [];
			for (var state = 0; state < 4; ++state) {
				this.eigenvectorColumnTex[side][state] = new FloatTexture2D(this.nx, this.nx);
			}
		}
		this.eigenvectorInverseColumnTex = [];
		for (var side = 0; side < 2; ++side) {
			this.eigenvectorInverseColumnTex[side] = [];
			for (var state = 0; state < 4; ++state) {
				this.eigenvectorInverseColumnTex[side][state] = new FloatTexture2D(this.nx, this.nx);
			}
		}
		this.jacobianColumnTex = [];
		for (var side = 0; side < 2; ++side) {
			this.jacobianColumnTex[side] = [];
			for (var state = 0; state < 4; ++state) {
				this.jacobianColumnTex[side][state] = new FloatTexture2D(this.nx, this.nx);
			}
		}	
		//qiTilde_{i-1/2},{j-1/2},side,state	
		this.dqTildeTex = [];
		for (var side = 0; side < 2; ++side) {
			this.dqTildeTex[side] = new FloatTexture2D(this.nx, this.nx);
		}

		//rTilde_{i-1/2},{j-1/2},side,state
		this.rTildeTex = []; 
		for (var side = 0; side < 2; ++side) {
			this.rTildeTex[side] = new FloatTexture2D(this.nx, this.nx); 
		}

		//number of ghost cells
		this.nghost = 2;

		//solver configuration
		this.boundaryMethod = 'periodic';
		this.fluxMethod = 'superbee';
		this.advectMethod = 'Burgers';
		this.drawToScreenMethod = 'Density';
	},
	resetSod : function() {
		var thiz = this;
		fbo.setColorAttachmentTex2D(0, this.qTex);
		fbo.draw({
			callback : function() {
				gl.viewport(0, 0, thiz.nx, thiz.nx);
				quadObj.draw({
					shader : resetSodShader,
					uniforms : {
						noiseAmplitude : useNoise ? noiseAmplitude : 0
					},
					texs : [thiz.noiseTex]
				});
			}
		});
	},
	resetWave : function() {
		var thiz = this;
		fbo.setColorAttachmentTex2D(0, this.qTex);
		fbo.draw({
			callback : function() {
				gl.viewport(0, 0, thiz.nx, thiz.nx);
				quadObj.draw({
					shader : resetWaveShader,
					uniforms : {
						noiseAmplitude : useNoise ? noiseAmplitude : 0
					},
					texs : [thiz.noiseTex]
				});
			}
		});
	},
	//http://www.astro.princeton.edu/~jstone/Athena/tests/kh/kh.html
	resetKelvinHemholtz : function() {
		var thiz = this;
		fbo.setColorAttachmentTex2D(0, this.qTex);
		fbo.draw({
			callback : function() {
				gl.viewport(0, 0, thiz.nx, thiz.nx);
				quadObj.draw({
					shader : resetKelvinHemholtzShader,
					uniforms : {
						noiseAmplitude : useNoise ? noiseAmplitude : 0
					},
					texs : [thiz.noiseTex]
				});
			}
		});
	},
	boundary : function() {
		boundaryMethods[this.boundaryMethod].call(this);
	},
	step : function(dt) {
		var dx = (xmax - xmin) / this.nx;
		var dy = (ymax - ymin) / this.nx;
		
		//apply boundary conditions
		this.boundary();

		//solve
		advectMethods[this.advectMethod].advect.call(this, dt);

		//boundary again
		this.boundary();

		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pressureTex.obj, 0);
		fbo.check();
		//compute pressure
		quadObj.draw({
			shader : computePressureShader,
			texs : [this.qTex]
		});
		
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.nextQTex.obj, 0);
		fbo.check();
		//apply momentum diffusion
		quadObj.draw({
			shader : applyPressureToMomentumShader,
			uniforms : {
				dt_dx : [dt / dx, dt / dy]
			},
			texs : [this.qTex, this.pressureTex]
		});
		this.swapQTexs();

		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.nextQTex.obj, 0);
		fbo.check();
		//apply work diffusion
		quadObj.draw({
			shader : applyPressureToWorkShader,
			uniforms : {
				dt_dx : [dt / dx, dt / dy]
			},
			texs : [this.qTex, this.pressureTex]
		});
		this.swapQTexs();

		//last boundary update
		this.boundary();
	},
	update : function() {
		gl.viewport(0, 0, this.nx, this.nx);
		fbo.bind();
			
		//do any pre-calcCFLTimestep preparation (Roe computes eigenvalues here)
		advectMethods[this.advectMethod].initStep.call(this);

		//get timestep
		var dt;
		if (useCFL) {
			dt = advectMethods[this.advectMethod].calCFLTimestep.call(this);
		} else {
			dt = fixedDT;
		}

		//do the update
		this.step(dt);
			
		fbo.unbind();
	},

	swapQTexs : function() {
		//swap
		var tmp = this.qTex;
		this.qTex = this.nextQTex;
		this.nextQTex = this.qTex;
	}
});


var Hydro = makeClass({
	init : function() {
		var size = Number($.url().param('size'));
		if (size === undefined || size !== size) size = 512;
		var gamma = Number($.url().param('gamma'));
		if (gamma === undefined || gamma !== gamma) gamma = 7/5;
		
		this.state = new HydroState({
			size : size,
			gamma : gamma
		});
	},
	update : function() {
		
		//todo adm or something
		//update a copy of the grid and its once-refined
		//...and a once-unrefined ... over mergeable cells only?
		//then test for errors and split when needed
		this.state.update();

		//TODO reduce shader to determine min and max of whatever rendered value we will be using
		//until then, fixed only!
	}
});

var hydro;

function update() {
	//iterate
	hydro.update();

	/*
	//extract eigenvector and inverse textures
	if (hydro.state.advectMethod == 'Riemann / Roe') {
		var nx = hydro.state.nx;
		var maxmaxerr = 0;
		for (var side = 0; side < 2; ++side) {
			var eigenvectors = [];
			var eigenvectorInverses = [];
			for (var row = 0; row < 4; ++row) {
				eigenvectors[row] = [];
				eigenvectorInverses[row] = [];
				for (var column = 0; column < 4; ++column) {
					eigenvectors[row][column] = getFloatTexData(fbo, hydro.state.eigenvectorColumnTex[side][column], row);
					eigenvectorInverses[row][column] = getFloatTexData(fbo, hydro.state.eigenvectorInverseColumnTex[side][column], row);
				}
			}
		
			//now test them all
			for (var i = 0; i < 4; ++i) {
				for (var j = 0; j < 4; ++j) {
					var maxErr = 0;
					for (var e = 0; e < nx * nx; ++e) {
						var s = 0;
						for (var k = 0; k < 4; ++k) {
							s += eigenvectors[i][k][e] * eigenvectorInverses[k][j][e];
						}
						if (i == j) s--;
						maxErr = Math.max(maxErr, Math.abs(s));
					}
					maxmaxerr = Math.max(maxmaxerr, maxErr);
					console.log('side',side,'coord',i,j,'maxerr',maxErr);
				}
			}
		}
		console.log('greatest max err',maxmaxerr);
		console.log('done!');
		hydro.state.advectMethod = 'Burgers';
	//looks like we're close to the identity matrix, but we're getting some error, and it's building in the system
	}
	*/

	//reset viewport
	gl.viewport(0, 0, GL.canvas.width, GL.canvas.height);
	
	//draw
	GL.draw();
	
	hydro.state.qTex.bind(0);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	hydro.state.pressureTex.bind(1);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	currentColorScheme.bind(2);

	GL.unitQuad.draw({
		shader : drawToScreenShader[hydro.state.drawToScreenMethod],
		uniforms : {
			lastMin : hydro.lastDataMin,
			lastMax : hydro.lastDataMax
		}
	});

	gl.bindTexture(gl.TEXTURE_2D, null);

	gl.activeTexture(gl.TEXTURE1);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.bindTexture(gl.TEXTURE_2D, null);

	gl.activeTexture(gl.TEXTURE0);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.bindTexture(gl.TEXTURE_2D, null);

	requestAnimFrame(update);
}

function onresize() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	GL.resize();
}

function buildSelect(id, key, map) {
	var select = $('#' + id);
	for (var k in map) {
		var option = $('<option>', {text : k});
		option.appendTo(select);
		if (hydro.state[key] == k) {
			option.attr('selected', 'true');
		}
	}
	select.change(function() {
		hydro.state[key] = select.val();
	});
}

//http://lab.concord.org/experiments/webgl-gpgpu/webgl.html
//encode shader test function
var exp2Table = [
	2.168404E-19, 4.336809E-19, 8.673617E-19, 1.734723E-18,
	3.469447E-18, 6.938894E-18, 1.387779E-17, 2.775558E-17,
	5.551115E-17, 1.110223E-16, 2.220446E-16, 4.440892E-16,
	8.881784E-16, 1.776357E-15, 3.552714E-15, 7.105427E-15,
	1.421085E-14, 2.842171E-14, 5.684342E-14, 1.136868E-13,
	2.273737E-13, 4.547474E-13, 9.094947E-13, 1.818989E-12,
	3.637979E-12, 7.275958E-12, 1.455192E-11, 2.910383E-11,
	5.820766E-11, 1.164153E-10, 2.328306E-10, 4.656613E-10,
	9.313226E-10, 1.862645E-09, 3.725290E-09, 7.450581E-09,
	1.490116E-08, 2.980232E-08, 5.960464E-08, 1.192093E-07,
	2.384186E-07, 4.768372E-07, 9.536743E-07, 1.907349E-06,
	3.814697E-06, 7.629395E-06, 1.525879E-05, 3.051758E-05,
	6.103516E-05, 1.220703E-04, 2.441406E-04, 4.882812E-04,
	9.765625E-04, 1.953125E-03, 3.906250E-03, 7.812500E-03,
	1.562500E-02, 3.125000E-02, 6.250000E-02, 1.250000E-01,
	2.500000E-01, 5.000000E-01, 1.000000E+00, 2.000000E+00,
	4.000000E+00, 8.000000E+00, 1.600000E+01, 3.200000E+01,
	6.400000E+01, 1.280000E+02, 2.560000E+02, 5.120000E+02,
	1.024000E+03, 2.048000E+03, 4.096000E+03, 8.192000E+03,
	1.638400E+04, 3.276800E+04, 6.553600E+04, 1.310720E+05,
	2.621440E+05, 5.242880E+05, 1.048576E+06, 2.097152E+06,
	4.194304E+06, 8.388608E+06, 1.677722E+07, 3.355443E+07,
	6.710886E+07, 1.342177E+08, 2.684355E+08, 5.368709E+08,
	1.073742E+09, 2.147484E+09, 4.294967E+09, 8.589935E+09,
	1.717987E+10, 3.435974E+10, 6.871948E+10, 1.374390E+11,
	2.748779E+11, 5.497558E+11, 1.099512E+12, 2.199023E+12,
	4.398047E+12, 8.796093E+12, 1.759219E+13, 3.518437E+13,
	7.036874E+13, 1.407375E+14, 2.814750E+14, 5.629500E+14,
	1.125900E+15, 2.251800E+15, 4.503600E+15, 9.007199E+15,
	1.801440E+16, 3.602880E+16, 7.205759E+16, 1.441152E+17,
	2.882304E+17, 5.764608E+17, 1.152922E+18, 2.305843E+18
];
function decodeFloatArray(input, output) {
	var
		m, e, i_sign,
		i, i4, len;

	for (i = 0, len = output.length; i < len; i += 1) {
		i4 = i * 4;
		m = input[i4 + 1] * 3.921569E-03
			+ input[i4 + 2] * 1.537870E-05
			+ input[i4 + 3] * 6.030863E-08;
		e = input[i4 + 0];
		i_sign = 0;

		if (e & 0x80) {
			i_sign = 1;
			e &= ~0x80;
		}
		if (e & 0x40) {
			m = -m;
			e &= ~0x40;
		}
		if (i_sign) {
			e = -e;
		}
		output[i] = m * exp2Table[e + 62];
	}
}
function getFloatTexData(fbo, tex, channel) {
	var destUint8Array = new Uint8Array(encodeTempTex.width * encodeTempTex.height * 4);
	fbo.setColorAttachmentTex2D(0, encodeTempTex);
	fbo.draw({
		callback : function() {
			gl.viewport(0, 0, encodeTempTex.width, encodeTempTex.height);
			quadObj.draw({
				shader : encodeShader[channel],
				texs : [tex]
			});
			gl.readPixels(0, 0, encodeTempTex.width, encodeTempTex.height, encodeTempTex.format, encodeTempTex.type, destUint8Array);
		}
	});
	var destFloat32Array = new Float32Array(destUint8Array.buffer);
window.destUint8Array = destUint8Array;
window.destFloat32Array = destFloat32Array;
	return destFloat32Array;
}


var sceneObjects = [];

var currentColorScheme;
var colorSchemes = {};

$(document).ready(function(){
	
	canvas = $('<canvas>', {
		css : {
			left : 0,
			top : 0,
			position : 'absolute'
		}
	}).prependTo(document.body).get(0);
	$(canvas).disableSelection()
	
	try {
		gl = GL.init(canvas, {debug:true});
	} catch (e) {
		$(canvas).remove();
		$('#webglfail').show();
		throw e;
	}

	FloatTexture2D = makeClass({
		super : GL.Texture2D,
		init : function(width, height) {
			var args = {};
			args.width = width;
			args.height = height;
			args.internalFormat = gl.RGBA;
			args.format = gl.RGBA;
			args.type = gl.FLOAT;
			args.minFilter = gl.NEAREST;
			args.magFilter = gl.NEAREST;
			args.wrap = {
				s : gl.REPEAT,
				t : gl.REPEAT
			};
			FloatTexture2D.super.call(this, args);
		}
	});

	quadObj = new GL.SceneObject({
		mode : gl.TRIANGLE_STRIP,
		attrs : {
			vertex : new GL.ArrayBuffer({
				dim : 2,
				data : [-1,-1, 1,-1, -1,1, 1,1]
			}),
			texCoord : new GL.ArrayBuffer({
				dim : 2,
				data : [0,0, 1,0, 0,1, 1,1]
			})
		},
		parent : null,
		static : true
	});

	//init shaders before init hydro (so it can call the resetSod or whatever)
	
		kernelVertexShader = new GL.VertexShader({
			code : GL.vertexPrecision + mlstr(function(){/*
attribute vec2 vertex;
attribute vec2 texCoord;
varying vec2 pos;
void main() {
	pos = texCoord; 
	gl_Position = vec4(vertex, 0., 1.);
}
*/})
		});

		resetSodShader = new GL.ShaderProgram({
			vertexShader : kernelVertexShader,
			fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform sampler2D randomTex;
uniform vec2 rangeMin; 
uniform vec2 rangeMax; 
uniform float noiseAmplitude;
void main() {
	vec2 gridPos = rangeMin + pos * (rangeMax - rangeMin);
	//I would use dpos functions, but it's only for initialization...
	float rho;
	if (gridPos.x < (.7 * rangeMin.x + .3 * rangeMax.x) 
		&& gridPos.y < (.7 * rangeMin.y + .3 * rangeMax.y))
	{
		rho = 1.;
	} else {
		rho = .1;
	}
	vec2 vel = vec2(0., 0.);
	vel.xy += (texture2D(randomTex, pos).xy - .5) * 2. * noiseAmplitude;
	float energyKinetic = .5 * dot(vel, vel);
	float energyThermal = 1.;
	float energyTotal = energyKinetic + energyThermal;
	gl_FragColor = vec4(rho, rho * vel.xy, rho * energyTotal);
}		
*/}),
			fragmentPrecision : 'best',
			uniforms : {
				randomTex : 0,
				rangeMin : [xmin, ymin],
				rangeMax : [xmax, ymax]
			}
		});

		resetWaveShader = new GL.ShaderProgram({
			vertexShader : kernelVertexShader,
			fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform sampler2D randomTex;
uniform vec2 rangeMin; 
uniform vec2 rangeMax; 
uniform float noiseAmplitude;
void main() {
	vec2 gridPos = rangeMin + pos * (rangeMax - rangeMin);
	float dg = .2 * (rangeMax.x - rangeMin.x);
	vec2 rangeMid = .5 * (rangeMax + rangeMin);
	vec2 gridPosFromCenter = gridPos - .5 * rangeMid;
	//Note I turned this down from 3. to 2. because GPU is currently using fixed dpos sizes
	float rho = 2. * exp(-dot(gridPosFromCenter, gridPosFromCenter) / (dg * dg)) + .1;
	vec2 vel = vec2(0., 0.);
	vel.xy += (texture2D(randomTex, pos).xy - .5) * 2. * noiseAmplitude;
	float energyKinetic = .5 * dot(vel, vel);
	float energyThermal = 1.;
	float energyTotal = energyKinetic + energyThermal;
	gl_FragColor = vec4(rho, rho * vel.xy, rho * energyTotal);
}		
*/}),
			fragmentPrecision : 'best',
			uniforms : {
				randomTex : 0,
				rangeMin : [xmin, ymin],
				rangeMax : [xmax, ymax]
			}
		});

		resetKelvinHemholtzShader = new GL.ShaderProgram({
			vertexShader : kernelVertexShader,
			fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform sampler2D randomTex;
uniform vec2 rangeMin; 
uniform vec2 rangeMax; 
uniform float noiseAmplitude;
uniform float gamma;
void main() {
	vec2 gridPos = rangeMin + pos * (rangeMax - rangeMin);
	float rho = 1.;
	vec2 vel = vec2(0., 0.);
	if (gridPos.y > (.75 * rangeMin.y + .25 * rangeMax.y) && 
		gridPos.y < (.25 * rangeMin.y + .75 * rangeMax.y))
	{
		rho = 2.;
		vel.x = .5;
	}
	else
	{
		rho = 1.;
		vel.x = -.5;
	}
	vel.xy += (texture2D(randomTex, pos).xy - .5) * 2. * noiseAmplitude;
	//P = (gamma - 1) rho (eTotal - eKinetic)
	//eTotal = P / ((gamma - 1) rho) + eKinetic
	float pressure = 2.5;
	float energyKinetic = .5 * dot(vel, vel);
	float energyTotal = pressure / ((gamma - 1.) * rho) + energyKinetic; 
	gl_FragColor = vec4(rho, rho * vel.xy, rho * energyTotal);
}		
*/}),
			fragmentPrecision : 'best',
			uniforms : {
				randomTex : 0,
				rangeMin : [xmin, ymin],
				rangeMax : [xmax, ymax]
			}
			//TODO make it periodic on the left/right borders and reflecting on the top/bottom borders	
		});

		burgersComputeInterfaceVelocityShader = new GL.ShaderProgram({
			vertexShader : kernelVertexShader,
			fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
uniform sampler2D qTex;
void main() {
	vec4 q = texture2D(qTex, pos);
	vec4 qxPrev = texture2D(qTex, pos - vec2(dpos.x, 0.));
	vec4 qyPrev = texture2D(qTex, pos - vec2(0., dpos.y));
	gl_FragColor = vec4(
		.5 * (q.y / q.x + qxPrev.y / qxPrev.x),
		.5 * (q.z / q.x + qyPrev.z / qyPrev.x),
		0., 1.);
}		
*/}),
			fragmentPrecision : 'best',
			uniforms : {
				qTex : 0
			}
		});

		$.each(coordNames, function(i, coordName) {
			burgersComputeFluxSlopeShader[i] = new GL.ShaderProgram({
				vertexShader : kernelVertexShader,
				fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
uniform sampler2D qTex;
uniform sampler2D uiTex;
void main() {
	vec2 sidestep = vec2(0.);
	sidestep[$side] = dpos[$side];
	
	vec4 qNext = texture2D(qTex, pos + sidestep);
	vec4 q = texture2D(qTex, pos);
	vec4 qPrev = texture2D(qTex, pos - sidestep);
	vec4 qPrev2 = texture2D(qTex, pos - 2.*sidestep);
	
	//dq = q_i,j - q_{{i,j}-dirs[side]}
	vec4 dq = q - qPrev; 
	
	vec4 s = sign(dq);
	s *= s;
	
	float ui = texture2D(uiTex, pos)[$side];
	float uigz = step(0., ui); 
	gl_FragColor = s * mix(qNext - q, qPrev - qPrev2, uigz) / dq;
}
*/}).replace(/\$side/g, i),
				fragmentPrecision : 'best',
				uniforms : {
					qTex : 0,
					uiTex : 1
				}
			});
		});

		$.each(fluxMethods, function(methodName,fluxMethodCode) {
			burgersComputeFluxShader[methodName] = [];
			$.each(coordNames, function(i, coordName) {
				burgersComputeFluxShader[methodName][i] = new GL.ShaderProgram({
					vertexShader : kernelVertexShader,
					fragmentCode : mlstr(function(){/*
vec4 fluxMethod(vec4 r) {
	$fluxMethodCode
}			
*/}).replace(/\$fluxMethodCode/g, fluxMethodCode)
+ mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
uniform float dt_dx;
uniform sampler2D qTex;
uniform sampler2D uiTex;
uniform sampler2D rTex;

void main() {
	vec2 sidestep = vec2(0., 0.);
	sidestep[$side] = dpos[$side];
	
	float ui = texture2D(uiTex, pos)[$side];
	float uigz = step(0., ui);

	vec4 qPrev = texture2D(qTex, pos - sidestep);
	vec4 q = texture2D(qTex, pos);

	gl_FragColor = ui * mix(q, qPrev, uigz);
	
	vec4 r = texture2D(rTex, pos);
	vec4 phi = fluxMethod(r);
	vec4 delta = phi * (q - qPrev);
	gl_FragColor += delta * .5 * abs(ui) * (1. - abs(ui * dt_dx));
}			
*/}).replace(/\$side/g, i),
					fragmentPrecision : 'best',
					uniforms : {
						qTex : 0,
						uiTex : 1,
						rTex : 2
					}
				});
			});
		});

		burgersUpdateStateShader = new GL.ShaderProgram({
			vertexShader : kernelVertexShader,
			fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
uniform vec2 dt_dx;
uniform sampler2D qTex;
uniform sampler2D fluxXTex;
uniform sampler2D fluxYTex;
void main() {
	vec4 q = texture2D(qTex, pos);
	vec4 fluxXL = texture2D(fluxXTex, pos);
	vec4 fluxXR = texture2D(fluxXTex, pos + vec2(dpos.x, 0.));
	vec4 fluxYL = texture2D(fluxYTex, pos);
	vec4 fluxYR = texture2D(fluxYTex, pos + vec2(0., dpos.y));
	gl_FragColor = q 
		- dt_dx.x * (fluxXR - fluxXL)
		- dt_dx.y * (fluxYR - fluxYL);
}		
*/}),
			fragmentPrecision : 'best',
			uniforms : {
				qTex : 0,
				fluxXTex : 1,
				fluxYTex : 2
			}
		});


		//used for Riemann

		$.each(coordNames, function(i,coordName) {
			roeComputeRoeValueShader[i] = new GL.ShaderProgram({
				vertexShader : kernelVertexShader,
				fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
uniform float gamma;
uniform sampler2D qTex;
void main() {
	vec2 sidestep = vec2(0.);
	sidestep[$side] = dpos[$side];
	vec4 q = texture2D(qTex, pos);
	vec4 qPrev = texture2D(qTex, pos - sidestep);

	float densityL = qPrev.x;
	vec2 velocityL = qPrev.yz / densityL; 
	float energyTotalL = qPrev.w / densityL;
	float energyKineticL = .5 * dot(velocityL, velocityL);
	float energyThermalL = energyTotalL - energyKineticL;
	float pressureL = (gamma - 1.) * densityL * energyThermalL;
	float speedOfSoundL = sqrt(gamma * pressureL / densityL);
	float hTotalL = energyTotalL + pressureL / densityL;
	float roeWeightL = sqrt(densityL);
	
	float densityR = q.x; 
	vec2 velocityR = q.yz / densityR;
	float energyTotalR = q.w / densityR; 
	float energyKineticR = .5 * dot(velocityR, velocityR);
	float energyThermalR = energyTotalR - energyKineticR;
	float pressureR = (gamma - 1.) * densityR * energyThermalR;
	float speedOfSoundR = sqrt(gamma * pressureR / densityR);
	float hTotalR = energyTotalR + pressureR / densityR;
	float roeWeightR = sqrt(densityR);

	float denom = roeWeightL + roeWeightR;
	vec2 velocity = (roeWeightL * velocityL + roeWeightR * velocityR) / denom;
	float hTotal = (roeWeightL * hTotalL + roeWeightR * hTotalR) / denom;
	
	float velocitySq = dot(velocity, velocity);
	float speedOfSound = sqrt((gamma - 1.) * (hTotal - .5 * velocitySq));
	
	gl_FragColor = vec4(
		velocity,
		hTotal,
		speedOfSound);
}
*/}).replace(/\$side/g, i),
				fragmentPrecision : 'best',
				uniforms : {
					qTex : 0
				}
			});
		});

		$.each(coordNames, function(i,coordName) {	
			roeComputeEigenvalueShader[i] = new GL.ShaderProgram({
				vertexShader : kernelVertexShader,
				fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform float gamma;
uniform sampler2D qTex;
uniform sampler2D roeValueTex;
void main() {
	vec4 roeValues = texture2D(roeValueTex, pos);
	vec2 velocity = roeValues.xy;
	float hTotal = roeValues.z; 
	float speedOfSound = roeValues.w;

	vec2 normal = vec2(0., 0.);
	normal[$side] = 1.;
	vec2 tangent = vec2(-normal.y, normal.x);
	
	float velocityN = dot(velocity, normal);
	float velocityT = dot(velocity, tangent);
	float velocitySq = dot(velocity, velocity);
	
	//eigenvalues: min, mid, max
	gl_FragColor = vec4(
		velocityN - speedOfSound,
		velocityN,
		velocityN,
		velocityN + speedOfSound);
}
*/}).replace(/\$side/g, i),
				fragmentPrecision : 'best',
				uniforms : {
					qTex : 0,
					roeValueTex : 1
				}
			});
		});

		var roeComputeEigenvectorColumnCode = [
			mlstr(function(){/*
	//min eigenvector
	gl_FragColor = vec4(
		1.,
		velocity.x - speedOfSound * normal.x,
		velocity.y - speedOfSound * normal.y,
		hTotal - speedOfSound * velocityN);
*/}),
			mlstr(function(){/*
	//mid eigenvector (normal)
	gl_FragColor = vec4(
		1.,
		velocity.x,
		velocity.y,
		.5 * velocitySq);
*/}),
			mlstr(function(){/*
	//mid eigenvector (tangent)
	gl_FragColor = vec4(
		0.,
		tangent.x,
		tangent.y,
		velocityT);
*/}),
			mlstr(function(){/*
	//max eigenvector
	gl_FragColor = vec4(
		1.,
		velocity.x + speedOfSound * normal.x,
		velocity.y + speedOfSound * normal.y,
		hTotal + speedOfSound * velocityN);
*/})
		];

		$.each(coordNames, function(i,coordName) {	
			roeComputeEigenvectorColumnShader[i] = [];
			$.each(roeComputeEigenvectorColumnCode, function(j,code) {
				roeComputeEigenvectorColumnShader[i][j] = new GL.ShaderProgram({
					vertexShader : kernelVertexShader,
					fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform float gamma;
uniform sampler2D qTex;
uniform sampler2D roeValueTex;
void main() {
	vec4 roeValues = texture2D(roeValueTex, pos);
	vec2 velocity = roeValues.xy;
	float hTotal = roeValues.z; 
	float speedOfSound = roeValues.w;

	vec2 normal = vec2(0., 0.);
	normal[$side] = 1.;
	vec2 tangent = vec2(-normal.y, normal.x);
	
	float velocityN = dot(velocity, normal);
	float velocityT = dot(velocity, tangent);
	float velocitySq = dot(velocity, velocity);
	
	
*/}).replace(/\$side/g, i) + code + '\n}',
					fragmentPrecision : 'best',
					uniforms : {
						qTex : 0,
						roeValueTex : 1
					}
				});
			});
		});

		/*
		rows are min, mid normal, mid tangent, max
		but I'm going to write these out in columns for easier reconstruction of the original matrix 
		... at least I think it'll be easier
		*/
		var roeComputeEigenvectorInverseColumnCode = [
			mlstr(function(){/*
	gl_FragColor = vec4(
		(.5 * (gamma - 1.) * velocitySq + speedOfSound * velocityN) / (2. * speedOfSound * speedOfSound),	//ei_0,0
		1. - .5 * (gamma - 1.) * velocitySq / (speedOfSound * speedOfSound),	//ei_1,0
		-velocityT, //ei_2,0
		(.5 * (gamma - 1.) * velocitySq - speedOfSound * velocityN) / (2. * speedOfSound * speedOfSound));	//ei_3,0
*/}),
			mlstr(function(){/*
	gl_FragColor = vec4(
		-(normal.x * speedOfSound + (gamma - 1.) * velocity.x) / (2. * speedOfSound * speedOfSound),	//ei_0,1
		(gamma - 1.) * velocity.x / (speedOfSound * speedOfSound),	//ei_1,1
		tangent.x,	//ei_2,1
		(normal.x * speedOfSound - (gamma - 1.) * velocity.x) / (2. * speedOfSound * speedOfSound));	//ei_3,1
*/}),
			mlstr(function(){/*
	gl_FragColor = vec4(
		-(normal.y * speedOfSound + (gamma - 1.) * velocity.y) / (2. * speedOfSound * speedOfSound),	//ei_0,2
		(gamma - 1.) * velocity.y / (speedOfSound * speedOfSound),	//ei_1,2
		tangent.y,	//ei_2,2
		(normal.y * speedOfSound - (gamma - 1.) * velocity.y) / (2. * speedOfSound * speedOfSound));	//ei_3,2
*/}),
			mlstr(function(){/*
	gl_FragColor = vec4(
		(gamma - 1.) / (2. * speedOfSound * speedOfSound),	//ei_0,3
		-(gamma - 1.) / (speedOfSound * speedOfSound),	//ei_1,3
		0.,	//ei_2,3
		(gamma - 1.) / (2. * speedOfSound * speedOfSound));	//ei_3,3
*/})
		];

		$.each(coordNames, function(i,coordName) {	
			roeComputeEigenvectorInverseColumnShader[i] = [];
			$.each(roeComputeEigenvectorInverseColumnCode, function(j,code) {
				roeComputeEigenvectorInverseColumnShader[i][j] = new GL.ShaderProgram({
					vertexShader : kernelVertexShader,
					fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform float gamma;
uniform sampler2D qTex;
uniform sampler2D roeValueTex;
void main() {
	vec4 roeValues = texture2D(roeValueTex, pos);
	vec2 velocity = roeValues.xy;
	float hTotal = roeValues.z; 
	float speedOfSound = roeValues.w;

	vec2 normal = vec2(0., 0.);
	normal[$side] = 1.;
	vec2 tangent = vec2(-normal.y, normal.x);
	
	float velocityN = dot(velocity, normal);
	float velocityT = dot(velocity, tangent);
	float velocitySq = dot(velocity, velocity);
	
*/}).replace(/\$side/g, i) + code + '\n}',
					fragmentPrecision : 'best',
					uniforms : {
						qTex : 0,
						roeValueTex : 1
					}
				});
			});
		});

		var roeComputeJacobianColumnCode = [
			//left/right
			[
				mlstr(function(){/*
	gl_FragColor = vec4(
		0.,
		.5 * (gamma - 1.) * velocitySq - velocity.x * velocity.x,
		-velocity.x * velocity.y,
		(.5 * (gamma - 1.) * velocitySq - hTotal) * velocity.x);
*/}),
				mlstr(function(){/*
	gl_FragColor = vec4(
		1.,
		(3. - gamma) * velocity.x,
		velocity.y,
		hTotal - (gamma - 1.) * velocity.x * velocity.x);
*/}),
				mlstr(function(){/*
	gl_FragColor = vec4(
		0.,
		-(gamma - 1.) * velocity.y,
		velocity.x,
		-(gamma - 1.) * velocity.x * velocity.y);
*/}),
				mlstr(function(){/*
	gl_FragColor = vec4(
		0.,
		gamma - 1.,
		0.,
		gamma * velocity.x);
*/})
			],
			//up/down
			[
				mlstr(function(){/*
	gl_FragColor = vec4(
		0.,
		-velocity.x * velocity.y,
		.5 * (gamma - 1.) * velocitySq - velocity.y * velocity.y,
		(.5 * (gamma - 1.) * velocitySq - hTotal) * velocity.y);
*/}),
				mlstr(function(){/*
	gl_FragColor = vec4(
		0.,
		velocity.y,
		-(gamma - 1.) * velocity.x,
		-(gamma - 1.) * velocity.x * velocity.y);
*/}),
				mlstr(function(){/*
	gl_FragColor = vec4(
		1.,
		velocity.x,
		(3. - gamma) * velocity.y,
		hTotal - (gamma - 1.) * velocity.y * velocity.y);
*/}),
				mlstr(function(){/*
	gl_FragColor = vec4(
		0.,
		0.,
		gamma - 1.,
		gamma * velocity.y);
*/})
			]
		];
	
		for (var side = 0; side < 2; ++side) {
			roeComputeJacobianColumnShader[side] = [];
			for (var column = 0; column < 4; ++column) {
				var code = roeComputeJacobianColumnCode[side][column];
				roeComputeJacobianColumnShader[side][column] = new GL.ShaderProgram({
					vertexShader : kernelVertexShader,
					fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform float gamma;
uniform sampler2D qTex;
uniform sampler2D roeValueTex;
void main() {
	vec4 roeValues = texture2D(roeValueTex, pos);
	vec2 velocity = roeValues.xy;
	float hTotal = roeValues.z; 
	float speedOfSound = roeValues.w;

	vec2 normal = vec2(0., 0.);
	normal[$side] = 1.;
	vec2 tangent = vec2(-normal.y, normal.x);
	
	float velocityN = dot(velocity, normal);
	float velocityT = dot(velocity, tangent);
	float velocitySq = dot(velocity, velocity);
	
*/}).replace(/\$side/g, side) + code + '\n}',
					fragmentPrecision : 'best',
					uniforms : {
						qTex : 0,
						roeValueTex : 1
					}
				});
			}
		}

		$.each(coordNames, function(i, coordName) {
			roeComputeDeltaQTildeShader[i] = new GL.ShaderProgram({
				vertexShader : kernelVertexShader,
				fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
uniform sampler2D qTex;
uniform sampler2D eigenvectorInverseCol0Tex;
uniform sampler2D eigenvectorInverseCol1Tex;
uniform sampler2D eigenvectorInverseCol2Tex;
uniform sampler2D eigenvectorInverseCol3Tex;
void main() {
	vec2 sidestep = vec2(0., 0.);
	sidestep[$side] = dpos[$side];

	vec4 eigenvectorInverseCol0 = texture2D(eigenvectorInverseCol0Tex, pos);
	vec4 eigenvectorInverseCol1 = texture2D(eigenvectorInverseCol1Tex, pos);
	vec4 eigenvectorInverseCol2 = texture2D(eigenvectorInverseCol2Tex, pos);
	vec4 eigenvectorInverseCol3 = texture2D(eigenvectorInverseCol3Tex, pos);
	mat4 eigenvectorInverse = mat4(
		eigenvectorInverseCol0,
		eigenvectorInverseCol1,
		eigenvectorInverseCol2,
		eigenvectorInverseCol3);

	vec4 qPrev = texture2D(qTex, pos - sidestep);
	vec4 q = texture2D(qTex, pos);
	vec4 dq = q - qPrev;

	gl_FragColor = eigenvectorInverse * dq;
}
*/}).replace(/\$side/g, i),
				fragmentPrecision : 'best',
				uniforms : {
					qTex : 0,
					eigenvectorInverseCol0Tex : 1,
					eigenvectorInverseCol1Tex : 2,
					eigenvectorInverseCol2Tex : 3,
					eigenvectorInverseCol3Tex : 4
				}
			});
		});	

		$.each(coordNames, function(i,coordName) {
			roeComputeFluxSlopeShader[i] = new GL.ShaderProgram({
				vertexShader : kernelVertexShader,
				fragmentCode : (mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
uniform sampler2D dqTildeTex;
uniform sampler2D eigenvalueTex;
void main() {
	vec2 sidestep = vec2(0.);
	sidestep[$side] = dpos[$side];
	vec4 dqTildePrev = texture2D(dqTildeTex, pos - sidestep); 
	vec4 dqTilde = texture2D(dqTildeTex, pos); 
	vec4 dqTildeNext = texture2D(dqTildeTex, pos + sidestep); 
	vec4 eigenvalues = texture2D(eigenvalueTex, pos);
*/}) + [0,1,2,3].map(function(j) {
	return mlstr(function(){/*
	if (abs(dqTilde[$j]) > 0.) {
		if (eigenvalues[$j] > 0.) {
			gl_FragColor[$j] = dqTildePrev[$j] / dqTilde[$j];
		} else {
			gl_FragColor[$j] = dqTildeNext[$j] / dqTilde[$j];
		}
	} else {
		gl_FragColor[$j] = 0.;
	}
*/}).replace(/\$j/g, j);
	}).join('')
+ '}').replace(/\$side/g, i),			
				
				fragmentPrecision : 'best',
				uniforms : {
					dqTildeTex : 0,
					eigenvalueTex : 1
				}
			});
		});

		$.each(fluxMethods, function(methodName,fluxMethodCode) {
			roeComputeFluxShader[methodName] = [];
			$.each(coordNames, function(i,coordName) {
				roeComputeFluxShader[methodName][i] = new GL.ShaderProgram({
					vertexShader : kernelVertexShader,
					fragmentCode : mlstr(function(){/*
vec4 fluxMethod(vec4 r) {
	$fluxMethodCode
}			
*/}).replace(/\$fluxMethodCode/g, fluxMethodCode)
+ mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
uniform float dt_dx;

uniform sampler2D qTex;
uniform sampler2D dqTildeTex;
uniform sampler2D rTildeTex;
uniform sampler2D eigenvalueTex;
uniform sampler2D jacobianCol0Tex;
uniform sampler2D jacobianCol1Tex;
uniform sampler2D jacobianCol2Tex;
uniform sampler2D jacobianCol3Tex;
uniform sampler2D eigenvectorCol0Tex;
uniform sampler2D eigenvectorCol1Tex;
uniform sampler2D eigenvectorCol2Tex;
uniform sampler2D eigenvectorCol3Tex;

mat4 scale(vec4 s) {
	return mat4(
		s[0], 0., 0., 0.,
		0., s[1], 0., 0.,
		0., 0., s[2], 0.,
		0., 0., 0., s[3]);
}

void main() {
	vec2 sidestep = vec2(0., 0.);
	sidestep[$side] = dpos[$side];

	vec4 q = texture2D(qTex, pos);
	vec4 qPrev = texture2D(qTex, pos - sidestep);

	vec4 eigenvalues = texture2D(eigenvalueTex, pos);

	vec4 eigenvectorCol0 = texture2D(eigenvectorCol0Tex, pos);
	vec4 eigenvectorCol1 = texture2D(eigenvectorCol1Tex, pos);
	vec4 eigenvectorCol2 = texture2D(eigenvectorCol2Tex, pos);
	vec4 eigenvectorCol3 = texture2D(eigenvectorCol3Tex, pos);
	mat4 eigenvectorMat = mat4(
		eigenvectorCol0, 
		eigenvectorCol1, 
		eigenvectorCol2, 
		eigenvectorCol3);

	vec4 jacobianCol0 = texture2D(jacobianCol0Tex, pos);
	vec4 jacobianCol1 = texture2D(jacobianCol1Tex, pos);
	vec4 jacobianCol2 = texture2D(jacobianCol2Tex, pos);
	vec4 jacobianCol3 = texture2D(jacobianCol3Tex, pos);
	mat4 jacobianMat = mat4(
		jacobianCol0, 
		jacobianCol1, 
		jacobianCol2, 
		jacobianCol3);

	vec4 fluxAvg = jacobianMat * ((q + qPrev) * .5);

	vec4 dqTilde = texture2D(dqTildeTex, pos);
	vec4 rTilde = texture2D(rTildeTex, pos);

	vec4 theta = step(eigenvalues, vec4(0.)) * 2. - 1.;
	vec4 phi = fluxMethod(rTilde);
	vec4 epsilon = eigenvalues * dt_dx;
	vec4 deltaFluxTilde = eigenvalues * dqTilde;
	vec4 fluxTilde = -.5 * deltaFluxTilde * (theta + phi * (epsilon - theta));
	gl_FragColor = fluxAvg + eigenvectorMat * fluxTilde;
}
*/}).replace(/\$side/g, i),
					fragmentPrecision : 'best',
					uniforms : {
						qTex : 0,
						dqTildeTex : 1,
						rTildeTex : 2,
						eigenvalueTex : 3,
						jacobianCol0Tex : 4,
						jacobianCol1Tex : 5,
						jacobianCol2Tex : 6,
						jacobianCol3Tex : 7,
						eigenvectorCol0Tex : 8,
						eigenvectorCol1Tex : 9,
						eigenvectorCol2Tex : 10,
						eigenvectorCol3Tex : 11
					}
				});
			});
		});

		//matches burgersUpdateStateShader
		roeUpdateStateShader = burgersUpdateStateShader;


		//pressure shaders
		

		computePressureShader = new GL.ShaderProgram({
			vertexShader : kernelVertexShader,
			fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
uniform float gamma;
uniform sampler2D qTex;
void main() {
	vec4 q = texture2D(qTex, pos);
	float rho = q.x;
	vec2 vel = q.yz / rho;
	float energyTotal = q.w / rho;
	float energyKinetic = .5 * dot(vel, vel);
	float energyThermal = energyTotal - energyKinetic;
	gl_FragColor = vec4(0.);
	gl_FragColor.x = (gamma - 1.) * rho * energyThermal;
}
*/}),
			fragmentPrecision : 'best',
			uniforms : {
				qTex : 0
			}
		});

		applyPressureToMomentumShader = new GL.ShaderProgram({
			vertexShader : kernelVertexShader,
			fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
uniform vec2 dt_dx;
uniform sampler2D qTex;
uniform sampler2D pressureTex;
void main() {
	vec2 dx = vec2(dpos.x, 0.);
	vec2 dy = vec2(0., dpos.y);
	
	vec2 posxp = pos + dx;
	vec2 posxn = pos - dx;
	vec2 posyp = pos + dy;
	vec2 posyn = pos - dy;

	float pressureXP = texture2D(pressureTex, posxp).x;
	float pressureXN = texture2D(pressureTex, posxn).x;
	float pressureYP = texture2D(pressureTex, posyp).x;
	float pressureYN = texture2D(pressureTex, posyn).x;

	gl_FragColor = texture2D(qTex, pos);
	gl_FragColor.y -= .5 * dt_dx.x * (pressureXP - pressureXN);
	gl_FragColor.z -= .5 * dt_dx.y * (pressureYP - pressureYN);
}
*/}),
			fragmentPrecision : 'best',
			uniforms : {
				qTex : 0,
				pressureTex : 1
			}
		});
		
		applyPressureToWorkShader = new GL.ShaderProgram({
			vertexShader : kernelVertexShader,
			fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
uniform vec2 dt_dx;
uniform sampler2D qTex;
uniform sampler2D pressureTex;
void main() {
	vec2 dx = vec2(dpos.x, 0.);
	vec2 dy = vec2(0., dpos.y);
	
	vec2 posxp = pos + dx;
	vec2 posxn = pos - dx;
	vec2 posyp = pos + dy;
	vec2 posyn = pos - dy;

	float pressureXP = texture2D(pressureTex, posxp).x;
	float pressureXN = texture2D(pressureTex, posxn).x;
	float pressureYP = texture2D(pressureTex, posyp).x;
	float pressureYN = texture2D(pressureTex, posyn).x;

	vec2 rho_u_XP = texture2D(qTex, posxp).xy;
	vec2 rho_u_XN = texture2D(qTex, posxn).xy;
	vec2 rho_v_YP = texture2D(qTex, posyp).xz;
	vec2 rho_v_YN = texture2D(qTex, posyn).xz;

	float uXP = rho_u_XP.y / rho_u_XP.x;
	float uXN = rho_u_XN.y / rho_u_XN.x;
	float vYP = rho_v_YP.y / rho_v_YP.x;
	float vYN = rho_v_YN.y / rho_v_YN.x;

	gl_FragColor = texture2D(qTex, pos);
	gl_FragColor.w -= .5 * (
		dt_dx.x * (pressureXP * uXP - pressureXN * uXN)
		+ dt_dx.y * (pressureYP * vYP - pressureYN * vYN));
}
*/}),
			fragmentPrecision : 'best',
			uniforms : {
				qTex : 0,
				pressureTex : 1
			}
		});

		solidShader = new GL.ShaderProgram({
			vertexShader : kernelVertexShader,
			fragmentCode : mlstr(function(){/*
uniform vec4 color;
void main() {
	gl_FragColor = color;
}		
*/}),
			fragmentPrecision : 'best',
			uniforms : {
				color : [0,0,0,0]
			}
		});

		copyShader = new GL.ShaderProgram({
			vertexShader : kernelVertexShader,
			fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform vec2 offset;
uniform sampler2D srcTex;
void main() {
	gl_FragColor = texture2D(srcTex, pos + offset);
}		
*/}),
			fragmentPrecision : 'best',
			uniforms : {
				srcTex : 0,
				offset : [0,0]
			}
		});

		fbo = new GL.Framebuffer({
			width : this.nx,
			height : this.nx
		});


	//init hydro after gl

	hydro = new Hydro();

	//init controls after hydro
	
	panel = $('#panel');	
	var panelContent = $('#content');
	$('#menu').click(function() {
		if (panelContent.css('display') == 'none') {
			panelContent.show();
		} else {
			panelContent.hide();
		}
	});

	$('#reset-sod').click(function(){ hydro.state.resetSod(); });
	$('#reset-wave').click(function(){ hydro.state.resetWave(); });
	$('#reset-kelvin-hemholtz').click(function(){ hydro.state.resetKelvinHemholtz(); });

	$('#use-noise').change(function() {
		useNoise = $(this).is(':checked');
	});

	(function(){
		var select = $('#gridsize');
		$.each([32, 64, 128, 256, 512, 1024, 2048], function(i,gridsize){
			var option = $('<option>', {text : gridsize});
			if (hydro.state.nx == gridsize) option.attr('selected', 'true');
			option.appendTo(select);
		});
		select.change(function(){
			var params = $.url().param();
			params.size = select.val();
			var url = location.href.match('[^?]*');
			var sep = '?';
			for (k in params) {
				if (k == '' && params[k] == '') continue;
				url += sep;
				url += k + '=' + params[k];
				sep = '&';
			}
			location.href = url;
		});
	})();

	buildSelect('boundary', 'boundaryMethod', boundaryMethods);
	buildSelect('flux-limiter', 'fluxMethod', fluxMethods);
	buildSelect('advect-method', 'advectMethod', advectMethods);
	buildSelect('draw-to-screen-method', 'drawToScreenMethod', drawToScreenMethods);

	hydro.lastDataMin = Number($('#dataRangeFixedMin').val());
	hydro.lastDataMax = Number($('#dataRangeFixedMax').val());
	hydro.updateLastDataRange = false;
	$('#dataRangeScaleNormalized').change(function() {
		if (!$(this).is(':checked')) return;
		hydro.updateLastDataRange = true;
	});
	$('#dataRangeScaleFixed').change(function() {
		if (!$(this).is(':checked')) return;
		hydro.updateLastDataRange = false;
		hydro.lastDataMin = Number($('#dataRangeFixedMin').val()); 
		hydro.lastDataMax = Number($('#dataRangeFixedMax').val()); 
	});
	$('#dataRangeFixedMin').change(function() {
		if (hydro.updateLastDataRange) return;
		hydro.lastDataMin = Number($('#dataRangeFixedMin').val()); 
	});
	$('#dataRangeFixedMax').change(function() {
		if (hydro.updateLastDataRange) return;
		hydro.lastDataMax = Number($('#dataRangeFixedMax').val()); 
	});

	$('#timeStepValue').val(fixedDT);
	$('#timeStepValue').change(function() {
		var v = Number($(this).val());
		if (v != v) return;	//stupid javascript ... convert anything it doesn't understand to NaNs...
		fixedDT = v;
	});

	//init gl stuff

	GL.view.ortho = true;
	GL.view.zNear = -1;
	GL.view.zFar = 1;
	GL.view.fovY = 125 / 200 * (xmax - xmin);
	GL.view.pos[0] = .5;
	GL.view.pos[1] = .5;

	colorSchemes.Heat = new GL.GradientTexture({
		width:256, 
		colors:[
			[0,0,0],
			[0,0,1],
			[1,1,0],
			[1,0,0],
		],
		dontRepeat : true
	});

	var isobarSize = 16;
	var isobarData = new Uint8Array(isobarSize);
	for (var i = 1; i < isobarSize; i += 2) {
		isobarData[i] = 255;
	}
	colorSchemes['B&W'] = new GL.Texture2D({
		width : isobarSize,
		height : 1,
		format : gl.LUMINANCE,
		internalFormat : gl.LUMINANCE,
		data : isobarData,
		minFilter : gl.LINEAR,
		magFilter : gl.NEAREST,
		generateMipmap : true,
		wrap : {s : gl.REPEAT, t : gl.CLAMP_TO_EDGE }
	});

	currentColorScheme = colorSchemes.Heat;

	for (var k in colorSchemes) {
		(function(){
			var v = colorSchemes[k];
			$('#color-scheme').append($('<option>', {
				value : k,
				text : k
			}));
		})();
	}
	$('#color-scheme').change(function() {
		var k = $(this).val();
		currentColorScheme = colorSchemes[k];
	});

	//http://lab.concord.org/experiments/webgl-gpgpu/webgl.html
	for (var channel = 0; channel < 4; ++channel) {
		encodeShader[channel] = new GL.ShaderProgram({
			vertexShader : kernelVertexShader,
			fragmentPrecision : 'best',
			fragmentCode : mlstr(function(){/*
float shift_right(float v, float amt) {
	v = floor(v) + 0.5;
	return floor(v / exp2(amt));
}

float shift_left(float v, float amt) {
	return floor(v * exp2(amt) + 0.5);
}

float mask_last(float v, float bits) {
	return mod(v, shift_left(1.0, bits));
}

float extract_bits(float num, float from, float to) {
	from = floor(from + 0.5);
	to = floor(to + 0.5);
	return mask_last(shift_right(num, from), to - from);
}

vec4 encode_float(float val) {
	if (val == 0.0)
		return vec4(0, 0, 0, 0);
	float sign = val > 0.0 ? 0.0 : 1.0;
	val = abs(val);
	float exponent = floor(log2(val));
	float biased_exponent = exponent + 127.0;
	float fraction = ((val / exp2(exponent)) - 1.0) * 8388608.0;
	
	float t = biased_exponent / 2.0;
	float last_bit_of_biased_exponent = fract(t) * 2.0;
	float remaining_bits_of_biased_exponent = floor(t);
	
	float byte4 = extract_bits(fraction, 0.0, 8.0) / 255.0;
	float byte3 = extract_bits(fraction, 8.0, 16.0) / 255.0;
	float byte2 = (last_bit_of_biased_exponent * 128.0 + extract_bits(fraction, 16.0, 23.0)) / 255.0;
	float byte1 = (sign * 128.0 + remaining_bits_of_biased_exponent) / 255.0;
	return vec4(byte4, byte3, byte2, byte1);
}

uniform sampler2D tex;
varying vec2 pos;
void main() {
	vec4 data = texture2D(tex, pos);
	gl_FragColor = encode_float(data[$channel]);
}
*/}).replace(/\$channel/g, channel)
		});
	}

	var drawToScreenVertexShader = new GL.VertexShader({
		code : GL.vertexPrecision + mlstr(function(){/*
attribute vec2 vertex;
varying vec2 pos; 
uniform mat4 mvMat;
uniform mat4 projMat;
void main() {
	pos = vertex;
	gl_Position = projMat * mvMat * vec4(vertex.xy, 0., 1.);
}
*/})
	});

	$.each(drawToScreenMethods, function(drawToScreenMethodName, drawToScreenMethodCode) {
		drawToScreenShader[drawToScreenMethodName] = new GL.ShaderProgram({
			vertexShader : drawToScreenVertexShader,
			fragmentCode : mlstr(function(){/*
#extension GL_OES_standard_derivatives : enable
varying vec2 pos;
uniform sampler2D qTex;
uniform sampler2D pressureTex;
uniform sampler2D gradientTex;
uniform float lastMin, lastMax;
uniform float gamma;
*/}) + mlstr(function(){/*
float drawToScreenMethod() {
	$drawToScreenMethodCode
}			
*/}).replace(/\$drawToScreenMethodCode/g, drawToScreenMethodCode)
+ mlstr(function(){/*
void main() {
	float v = (drawToScreenMethod() - lastMin) / (lastMax - lastMin);
	gl_FragColor = texture2D(gradientTex, vec2(v, .5)); 
}	
*/}),
			fragmentPrecision : 'best',
			uniforms : {
				qTex : 0,
				pressureTex : 1,
				gradientTex : 2
			}
		});
	});

	//make grid
	hydro.update();
	
	var zoomFactor = .0003;	// upon mousewheel
	var dragging = false;
	mouse = new Mouse3D({
		pressObj : canvas,
		mousedown : function() {
			dragging = false;
		},
		move : function(dx,dy) {
			dragging = true;
			var aspectRatio = canvas.width / canvas.height;
			GL.view.pos[0] -= dx / canvas.width * 2 * (aspectRatio * GL.view.fovY);
			GL.view.pos[1] += dy / canvas.height * 2 * GL.view.fovY;
			GL.updateProjection();
		},
		zoom : function(zoomChange) {
			dragging = true;
			var scale = Math.exp(-zoomFactor * zoomChange);
			GL.view.fovY *= scale 
			GL.updateProjection();
		}
	});
	
	//start it off
	$(window).resize(onresize);
	onresize();
	update();


	//check ...	
	var checkCoordAccuracyShader = new GL.ShaderProgram({
		vertexShader : kernelVertexShader,
		fragmentPrecision : 'best',
		fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform vec2 dpos;
void main() {
	gl_FragColor = vec4(gl_FragCoord.xy*dpos, dpos);
}
*/}),
		uniforms : {
			dpos : [
				1/hydro.state.nx,
				1/hydro.state.nx
			]
		}
	});

	var nx = hydro.state.nx;
	var tmpTex = new FloatTexture2D(nx, nx); 
	fbo.setColorAttachmentTex2D(0, tmpTex);
	fbo.draw({
		callback : function() {
			gl.viewport(0, 0, tmpTex.width, tmpTex.height);
			quadObj.draw({
				shader : checkCoordAccuracyShader
			});
		}
	});
	var coords = [];
	var maxErr = [];
	for (var channel = 0; channel < 4; ++channel) {
		coords[channel] = getFloatTexData(fbo, tmpTex, channel);
		maxErr[channel] = 0;
	}
	for (var j = 0; j < nx; ++j) {
		for (var i = 0; i < nx; ++i) {
			var target = [
				(i + .5) / nx,
				(j + .5) / nx,
				1/nx,
				1/nx
			];
			for (var channel = 0; channel < 4; ++channel) {
				var err = Math.abs(coords[channel][i+nx*j] - target[channel]);
				maxErr[channel] = Math.max(err, maxErr[channel]);
			}
		}
	}
	console.log('max coord errors:', maxErr);

});
