/*
1D ADM
2D: Burger at least
2D ADM
2D unstructured

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
var mouse;

var drawToScreenShader;

//interface directions
var dirs = [[1,0], [0,1]];


//provide a function with a mult-line comment
//this returns the comment as a string
//http://tomasz.janczuk.org/2013/05/multi-line-strings-in-javascript-and.html
function mlstr(f) {
	return f.toString().match(/[^]*\/\*([^]*)\*\/\}$/)[1];
}

/*
output:
matrix
eigenvalues
eigenvectors

input:
velocity
hTotal
speedOfSound
*/
function buildEigenstate(offset, matrix, eigenvalues, eigenvectors, eigenvectorsInverse, velocityX, velocityY, hTotal, gamma, normalX, normalY) {

	if ((hTotal - .5 * (velocityX * velocityX + velocityY * velocityY)) < 0) throw 'sqrt error';

	//calculate matrix & eigenvalues & vectors at interface from state at interface
	var speedOfSound = Math.sqrt((gamma - 1) * (hTotal - .5 * (velocityX * velocityX + velocityY * velocityY)));
	var tangentX = -normalY;
	var tangentY = normalX;
	var velocityN = velocityX * normalX + velocityY * normalY;
	var velocityT = velocityX * tangentX + velocityY * tangentY;
	var velocitySq = velocityX * velocityX + velocityY * velocityY;	
	
	//eigenvalues: min, mid, max
	eigenvalues[0 + 4 * offset] = velocityN - speedOfSound;
	eigenvalues[1 + 4 * offset] = velocityN;
	eigenvalues[2 + 4 * offset] = velocityN;
	eigenvalues[3 + 4 * offset] = velocityN + speedOfSound;

	//I'm going with http://people.nas.nasa.gov/~pulliam/Classes/New_notes/euler_notes.pdf

	//min eigenvector
	eigenvectors[0 + 4 * (0 + 4 * offset)] = 1;
	eigenvectors[1 + 4 * (0 + 4 * offset)] = velocityX - speedOfSound * normalX;
	eigenvectors[2 + 4 * (0 + 4 * offset)] = velocityY - speedOfSound * normalY;
	eigenvectors[3 + 4 * (0 + 4 * offset)] = hTotal - speedOfSound * velocityN;
	//mid eigenvector (normal)
	eigenvectors[0 + 4 * (1 + 4 * offset)] = 1;
	eigenvectors[1 + 4 * (1 + 4 * offset)] = velocityX;
	eigenvectors[2 + 4 * (1 + 4 * offset)] = velocityY;
	eigenvectors[3 + 4 * (1 + 4 * offset)] = .5 * velocitySq;
	//mid eigenvector (tangent)
	eigenvectors[0 + 4 * (2 + 4 * offset)] = 0;
	eigenvectors[1 + 4 * (2 + 4 * offset)] = tangentX;
	eigenvectors[2 + 4 * (2 + 4 * offset)] = tangentY;
	eigenvectors[3 + 4 * (2 + 4 * offset)] = velocityT;
	//max eigenvector
	eigenvectors[0 + 4 * (3 + 4 * offset)] = 1;
	eigenvectors[1 + 4 * (3 + 4 * offset)] = velocityX + speedOfSound * normalX;
	eigenvectors[2 + 4 * (3 + 4 * offset)] = velocityY + speedOfSound * normalY;
	eigenvectors[3 + 4 * (3 + 4 * offset)] = hTotal + speedOfSound * velocityN;
	
	//calculate eigenvector inverses ... 
	//min row
	eigenvectorsInverse[0 + 4 * (0 + 4 * offset)] = (.5 * (gamma - 1) * velocitySq + speedOfSound * velocityN) / (2 * speedOfSound * speedOfSound);
	eigenvectorsInverse[0 + 4 * (1 + 4 * offset)] = -(normalX * speedOfSound + (gamma - 1) * velocityX) / (2 * speedOfSound * speedOfSound);
	eigenvectorsInverse[0 + 4 * (2 + 4 * offset)] = -(normalY * speedOfSound + (gamma - 1) * velocityY) / (2 * speedOfSound * speedOfSound);
	eigenvectorsInverse[0 + 4 * (3 + 4 * offset)] = (gamma - 1) / (2 * speedOfSound * speedOfSound);
	//mid normal row
	eigenvectorsInverse[1 + 4 * (0 + 4 * offset)] = 1 - .5 * (gamma - 1) * velocitySq / (speedOfSound * speedOfSound);
	eigenvectorsInverse[1 + 4 * (1 + 4 * offset)] = (gamma - 1) * velocityX / (speedOfSound * speedOfSound);
	eigenvectorsInverse[1 + 4 * (2 + 4 * offset)] = (gamma - 1) * velocityY / (speedOfSound * speedOfSound);
	eigenvectorsInverse[1 + 4 * (3 + 4 * offset)] = -(gamma - 1) / (speedOfSound * speedOfSound);
	//mid tangent row
	eigenvectorsInverse[2 + 4 * (0 + 4 * offset)] = -velocityT; 
	eigenvectorsInverse[2 + 4 * (1 + 4 * offset)] = tangentX;
	eigenvectorsInverse[2 + 4 * (2 + 4 * offset)] = tangentY;
	eigenvectorsInverse[2 + 4 * (3 + 4 * offset)] = 0;
	//max row
	eigenvectorsInverse[3 + 4 * (0 + 4 * offset)] = (.5 * (gamma - 1) * velocitySq - speedOfSound * velocityN) / (2 * speedOfSound * speedOfSound);
	eigenvectorsInverse[3 + 4 * (1 + 4 * offset)] = (normalX * speedOfSound - (gamma - 1) * velocityX) / (2 * speedOfSound * speedOfSound);
	eigenvectorsInverse[3 + 4 * (2 + 4 * offset)] = (normalY * speedOfSound - (gamma - 1) * velocityY) / (2 * speedOfSound * speedOfSound);
	eigenvectorsInverse[3 + 4 * (3 + 4 * offset)] = (gamma - 1) / (2 * speedOfSound * speedOfSound);

	//calculate matrix
	var identCheck = [];
	var identBad = false;
	for (var i = 0; i < 4; ++i) {
		for (var j = 0; j < 4; ++j) {
			var s = 0;
			var d = 0;
			for (var k = 0; k < 4; ++k) {
				/** /
				s += eigenvectorsInverse[i + 4 * (k + 4 * offset)] * eigenvectors[k + 4 * (j + 4 * offset)] * eigenvalues[k + 4 * offset];
				identCheck += eigenvectorsInverse[i + 4 * (k + 4 * offset)] * eigenvectors[k + 4 * (j + 4 * offset)];
				/**/
				s += eigenvectors[i + 4 * (k + 4 * offset)] * eigenvalues[k + 4 * offset] * eigenvectorsInverse[k + 4 * (j + 4 * offset)];
				d += eigenvectors[i + 4 * (k + 4 * offset)] * eigenvectorsInverse[k + 4 * (j + 4 * offset)];
				/**/
			}
			matrix[i + 4 * (j + 4 * offset)] = s;
			identCheck[i + 4 * j] = d;
			var epsilon = 1e-5;
			if (Math.abs(d - (i == j ? 1 : 0)) > epsilon) identBad = true;
		}
	}
	if (identBad) {
		console.log('bad eigen basis', identCheck);
	}
	/** /	
	function f32subset(a, o, s) {
		var d = new Float32Array(s);
		for (var i = 0; i < s; ++i) {
			d[i] = a[i+o];
		}
		return d;
	}
	console.log('offset',offset);
	console.log('velocity',velocityX,velocityY);
	console.log('hTotal',hTotal);
	console.log('gamma',gamma);
	console.log('normal',normalX,normalY);

	console.log('eigenvalues:',f32subset(eigenvalues, 4*offset, 4));
	console.log('eigenvectors:',f32subset(eigenvectors, 16*offset, 16));
	console.log('eigenvectors^-1:',f32subset(eigenvectorsInverse, 16*offset, 16));
	console.log('matrix:',f32subset(matrix, 16*offset, 16));
	console.log('e^-1 * e:',identCheck);
	throw 'here';
	/**/
}

var fluxMethods = {
	donorCell : function(r) { return 0; },
	laxWendroff : function(r) { return 1; },
	
	beamWarming : function(r) { return r; },
	fromm : function(r) { return .5 * (1 + r); },

	//Wikipedia
	CHARM : function(r) { return Math.max(0, r*(3*r+1)/((r+1)*(r+1)) ); },
	HCUS : function(r) { return Math.max(0, 1.5 * (r + Math.abs(r)) / (r + 2) ); },
	HQUICK : function(r) { return Math.max(0, 2 * (r + Math.abs(r)) / (r + 3) ); },
	Koren : function(r) { return Math.max(0, Math.min(2*r, (1 + 2*r)/3 ,2) ); },
	minmod : function(r) { return Math.max(0, Math.min(r,1) ); },
	Oshker : function(r) { return Math.max(0, Math.min(r,1.5) ); },	//replace 1.5 with 1 <= beta <= 2	
	ospre : function(r) { return .5 * (r*r + r) / (r*r + r + 1); },
	smart : function(r) { return Math.max(0, Math.min(2 * r, .25 + .75 * r, 4)); },
	Sweby : function(r) { return Math.max(0, Math.min(1.5 * r, 1), Math.min(r, 1.5)); },	//replace 1.5 with 1 <= beta <= 2
	UMIST : function(r) { return Math.max(0, Math.min(2*r, .75 + .25*r, .25 + .75*r, 2)); },	
	vanAlbada1 : function(r) { return (r * r + r) / (r * r + 1); },
	vanAlbada2 : function(r) { return 2 * r / (r * r + 1); },
	
	vanLeer : function(r) { return (r + Math.abs(r)) / (1 + Math.abs(r)); },
	MC : function(r) { return Math.max(0, Math.min(2, .5 * (1 + r), 2 * r)); },
	superbee : function(r) { return Math.max(0,Math.min(1,2*r),Math.min(2,r)); }
};

var boundaryMethods = {
	none : function() {},	//purely debugging
	periodic : function() {
		var thiz = this;
		this.fbo.setColorAttachmentTex2D(0, this.nextQTex);
		this.fbo.draw({
			callback : function() {
				gl.viewport(0, 0, thiz.nx, thiz.nx);

				//initial copy
				thiz.drawQuad({
					min : [0,0],
					max : [thiz.nx, thiz.nx],
					shader : thiz.copyShader,
					texs : [thiz.qTex]
				});

				//left reads right
				thiz.drawLine({
					src : [0,0],
					dst : [0, thiz.nx-1],
					shader : thiz.copyShader,
					uniforms : {
						offset : [(thiz.nx - 5)/thiz.nx, 0]
					},
					texs : [thiz.qTex]
				});
				thiz.drawLine({
					src : [1,0],
					dst : [1, thiz.nx-1],
					shader : thiz.copyShader,
					uniforms : {
						offset : [(thiz.nx - 5)/thiz.nx, 0]
					},
					texs : [thiz.qTex]
				});
				
				//right reads left
				thiz.drawLine({
					src : [thiz.nx-3, 0],
					dst : [thiz.nx-3, thiz.nx-1],
					shader : thiz.copyShader,
					uniforms : {
						offset : [-(thiz.nx-5)/thiz.nx, 0]
					},
					texs : [thiz.qTex]
				});
				thiz.drawLine({
					src : [thiz.nx-2, 0],
					dst : [thiz.nx-2, thiz.nx-1],
					shader : thiz.copyShader,
					uniforms : {
						offset : [-(thiz.nx-5)/thiz.nx, 0]
					},
					texs : [thiz.qTex]
				});

				//bottom reads top
				thiz.drawLine({
					src : [0,0],
					dst : [thiz.nx-1, 0],
					shader : thiz.copyShader,
					uniforms : {
						offset : [0, (thiz.nx - 5)/thiz.nx]
					},
					texs : [thiz.qTex]
				});
				thiz.drawLine({
					src : [0,1],
					dst : [thiz.nx-1, 1],
					shader : thiz.copyShader,
					uniforms : {
						offset : [0, (thiz.nx - 5)/thiz.nx]
					},
					texs : [thiz.qTex]
				});

				//top reads bottom
				thiz.drawLine({
					src : [0, thiz.nx-3],
					dst : [thiz.nx-1, thiz.nx-3],
					shader : thiz.copyShader,
					uniforms : {
						offset : [0, -(thiz.nx-5)/thiz.nx]
					},
					texs : [thiz.qTex]
				});
				thiz.drawLine({
					src : [0, thiz.nx-2],
					dst : [thiz.nx-1, thiz.nx-2],
					shader : thiz.copyShader,
					uniforms : {
						offset : [0, -(thiz.nx-5)/thiz.nx]
					},
					texs : [thiz.qTex]
				});
		
			}
		});
		this.swapQTexs();
	},
	mirror : function(nx,q) {

		for (var i = 0; i < nx; ++i) {
			//top
			q[0 + 4 * (i + nx * (0))] = q[0 + 4 * (i + nx * (3))];
			q[0 + 4 * (i + nx * (1))] = q[0 + 4 * (i + nx * (2))];
			q[0 + 4 * (i + nx * (nx-2))] = q[0 + 4 * (i + nx * (nx-3))];
			q[0 + 4 * (i + nx * (nx-1))] = q[0 + 4 * (i + nx * (nx-4))];
			q[1 + 4 * (i + nx * (0))] = -q[1 + 4 * (i + nx * (3))];
			q[1 + 4 * (i + nx * (1))] = -q[1 + 4 * (i + nx * (2))];
			q[1 + 4 * (i + nx * (nx-2))] = -q[1 + 4 * (i + nx * (nx-3))];
			q[1 + 4 * (i + nx * (nx-1))] = -q[1 + 4 * (i + nx * (nx-4))];
			q[2 + 4 * (i + nx * (0))] = -q[2 + 4 * (i + nx * (3))];
			q[2 + 4 * (i + nx * (1))] = -q[2 + 4 * (i + nx * (2))];
			q[2 + 4 * (i + nx * (nx-2))] = -q[2 + 4 * (i + nx * (nx-3))];
			q[2 + 4 * (i + nx * (nx-1))] = -q[2 + 4 * (i + nx * (nx-4))];
			q[3 + 4 * (i + nx * (0))] = q[3 + 4 * (i + nx * (3))];
			q[3 + 4 * (i + nx * (1))] = q[3 + 4 * (i + nx * (2))];
			q[3 + 4 * (i + nx * (nx-2))] = q[3 + 4 * (i + nx * (nx-3))];
			q[3 + 4 * (i + nx * (nx-1))] = q[3 + 4 * (i + nx * (nx-4))];
			//left
			q[0 + 4 * (0 + nx * i)] = q[0 + 4 * (3 + nx * i)];
			q[0 + 4 * (1 + nx * i)] = q[0 + 4 * (2 + nx * i)];
			q[0 + 4 * (nx-2 + nx * i)] = q[0 + 4 * (nx-3 + nx * i)];
			q[0 + 4 * (nx-1 + nx * i)] = q[0 + 4 * (nx-4 + nx * i)];
			q[1 + 4 * (0 + nx * i)] = -q[1 + 4 * (3 + nx * i)];
			q[1 + 4 * (1 + nx * i)] = -q[1 + 4 * (2 + nx * i)];
			q[1 + 4 * (nx-2 + nx * i)] = -q[1 + 4 * (nx-3 + nx * i)];
			q[1 + 4 * (nx-1 + nx * i)] = -q[1 + 4 * (nx-4 + nx * i)];
			q[2 + 4 * (0 + nx * i)] = -q[2 + 4 * (3 + nx * i)];
			q[2 + 4 * (1 + nx * i)] = -q[2 + 4 * (2 + nx * i)];
			q[2 + 4 * (nx-2 + nx * i)] = -q[2 + 4 * (nx-3 + nx * i)];
			q[2 + 4 * (nx-1 + nx * i)] = -q[2 + 4 * (nx-4 + nx * i)];
			q[3 + 4 * (0 + nx * i)] = q[3 + 4 * (3 + nx * i)];
			q[3 + 4 * (1 + nx * i)] = q[3 + 4 * (2 + nx * i)];
			q[3 + 4 * (nx-2 + nx * i)] = q[3 + 4 * (nx-3 + nx * i)];
			q[3 + 4 * (nx-1 + nx * i)] = q[3 + 4 * (nx-4 + nx * i)];
		}
	},
	dirichlet : function() {
		var thiz = this;
		this.fbo.setColorAttachmentTex2D(0, this.nextQTex);
		this.fbo.draw({
			callback : function() {
				gl.viewport(0, 0, thiz.nx, thiz.nx);

				//initial copy
				thiz.drawQuad({
					min : [0,0],
					max : [thiz.nx, thiz.nx],
					shader : thiz.copyShader,
					texs : [thiz.qTex]
				});
			
				//left 
				thiz.drawQuad({
					min : [0,0],
					max : [2, thiz.nx],
					shader : thiz.solidShader,
					texs : [thiz.qTex]
				});
			
				//right 
				thiz.drawQuad({
					min : [thiz.nx-4, 0],
					max : [thiz.nx, thiz.nx],
					shader : thiz.solidShader,
					texs : [thiz.qTex]
				});

				//bottom 
				thiz.drawQuad({
					min : [0,0],
					max : [thiz.nx, 2],
					shader : thiz.solidShader,
					texs : [thiz.qTex]
				});
						
				//top 
				thiz.drawQuad({
					min : [0, thiz.nx-4],
					max : [thiz.nx, thiz.nx],
					shader : thiz.solidShader,
					texs : [thiz.qTex]
				});
			}
		});
		this.swapQTexs();
	},
	constant : function(nx,q) {
		for (var i = 0; i < nx; ++i) {
			for (var state = 0; state < 4; ++state) {
				q[state + 4 * (i + nx * (0))] = q[state + 4 * (i + nx * (1))] = q[state + 4 * (i + nx * (2))];
				q[state + 4 * (i + nx * (nx-1))] = q[state + 4 * (i + nx * (nx-2))] = q[state + 4 * (i + nx * (nx-3))];
				q[state + 4 * (0 + nx * i)] = q[state + 4 * (1 + nx * i)] = q[state + 4 * (2 + nx * i)];
				q[state + 4 * (nx-1 + nx * i)] = q[state + 4 * (nx-2 + nx * i)] = q[state + 4 * (nx-3 + nx * i)];
			}
		}
	}
};

//called with 'this' the HydroState
var advectMethods = {
	Burgers : {
		initStep : function() {
			//TODO reduce to determien CFL
			//until then, fixed!
			return .0012;
		},
		advect : function(dt) {
			
			var thiz = this;
			var dx = (xmax - xmin) / (this.nx - 1);
			var dy = (ymax - ymin) / (this.nx - 1);
			var dxi = [dx, dy];
			
			gl.viewport(0, 0, thiz.nx, thiz.nx);

			this.fbo.setColorAttachmentTex2D(0, this.uiTex);
			this.fbo.draw({
				callback : function() {
					//get velocity at interfaces from state
					thiz.drawQuad({
						min : [0,0],
						max : [thiz.nx, thiz.nx],
						shader : thiz.burgersComputeInterfaceVelocityShader,
						texs : [thiz.qTex]
					});
					thiz.zeroBorder(thiz.nghost, thiz.nx);
				}
			});
		
			for (var side = 0; side < 2; ++side) {
				this.fbo.setColorAttachmentTex2D(0, this.rTex[side]);
				this.fbo.draw({
					callback : function() {
						thiz.drawQuad({
							min : [0,0],
							max : [thiz.nx, thiz.nx],
							shader : thiz.burgersComputeFluxSlopeShader[side],
							texs : [
								thiz.qTex, 
								thiz.uiTex
							]
						});
						
						//boundary zero
						thiz.zeroBorder(thiz.nghost, thiz.nx);
					}
				});
			}

			//construct flux:
			for (var side = 0; side < 2; ++side) {
				this.fbo.setColorAttachmentTex2D(0, this.fluxTex[side]);
				this.fbo.draw({
					callback : function() {
						thiz.drawQuad({
							min : [0,0],
							max : [thiz.nx, thiz.nx],
							shader : thiz.burgersComputeFluxShader[side],
							uniforms : {
								dt_dx : dt / dxi[side]
							},
							texs : [
								thiz.qTex,
								thiz.uiTex,
								thiz.rTex[side]
							]
						});
					
						//boundary zero
						thiz.zeroBorder(thiz.nghost-1, thiz.nx);
					}
				});
			}

			//update state
			this.fbo.setColorAttachmentTex2D(0, this.nextQTex);
			this.fbo.draw({
				callback : function() {
					thiz.drawQuad({
						min : [0,0],
						max : [thiz.nx, thiz.nx],
						shader : thiz.burgersUpdateStateShader,
						uniforms : {
							side : side,
							dt_dx : [
								dt / dx,
								dt / dy
							]
						},
						texs : [
							thiz.qTex, 
							thiz.fluxTex[0], 
							thiz.fluxTex[1]
						]
					});
				
					//boundary zero
					thiz.zeroBorder(thiz.nghost-1, thiz.nx);
				}
			});
			this.swapQTexs();
		}
	},
	Riemann : {
		initStep : function() {
			var mindum = undefined;
			for (var j = 1; j < this.nx; ++j) {
				for (var i = 1; i < this.nx; ++i) {
					for (var side = 0; side < 2; ++side) {
						var qIndexL = 4 * (i - dirs[side][0] + this.nx * (j - dirs[side][1]));
						var densityL = this.q[0 + qIndexL];
						var velocityXL = this.q[1 + qIndexL] / densityL;
						var velocityYL = this.q[2 + qIndexL] / densityL;
						var energyTotalL = this.q[3 + qIndexL] / densityL;
						var energyKineticL = .5 * (velocityXL * velocityXL + velocityYL * velocityYL);
						var energyThermalL = energyTotalL - energyKineticL;
						var pressureL = (this.gamma - 1) * densityL * energyThermalL;
						var speedOfSoundL = Math.sqrt(this.gamma * pressureL / densityL);
						var hTotalL = energyTotalL + pressureL / densityL;
						var roeWeightL = Math.sqrt(densityL);
						
						var qIndexR = 4 * (i + this.nx * j);
						var densityR = this.q[0 + qIndexR];
						var velocityXR = this.q[1 + qIndexR] / densityR;
						var velocityYR = this.q[2 + qIndexR] / densityR;
						var energyTotalR = this.q[3 + qIndexR] / densityR;
						var energyKineticR = .5 * (velocityXR * velocityXR + velocityYR * velocityYR);
						var energyThermalR = energyTotalR - energyKineticR;
						var pressureR = (this.gamma - 1) * densityR * energyThermalR;
						var speedOfSoundR = Math.sqrt(this.gamma * pressureR / densityR);
						var hTotalR = energyTotalR + pressureR / densityR;
						var roeWeightR = Math.sqrt(densityR);

						var denom = roeWeightL + roeWeightR;
						var velocityX = (roeWeightL * velocityXL + roeWeightR * velocityXR) / denom;
						var velocityY = (roeWeightL * velocityYL + roeWeightR * velocityYR) / denom;
						var hTotal = (roeWeightL * hTotalL + roeWeightR * hTotalR) / denom;
						
						buildEigenstate(
							 //index into interface element.  
							 //from there you'll have to scale by cell size.  
							 //Thus manually recreating the automatic storage of C structures. 
							 //JavaScript, why can't you be more like LuaJIT? 
							 side + 2 * (i + (this.nx+1) * j),	
							 this.interfaceMatrix,	//dim^2 = 16
							 this.interfaceEigenvalues,	//dim = 4
							 this.interfaceEigenvectors,	//dim^2 = 16
							 this.interfaceEigenvectorsInverse,	//dim^2 = 16
							 velocityX, velocityY, hTotal, this.gamma,
							 dirs[side][0], dirs[side][1]);

						var maxLambda = Math.max(0, 
							this.interfaceEigenvalues[0+4*(side+2*(i+(this.nx+1)*j))],
							this.interfaceEigenvalues[1+4*(side+2*(i+(this.nx+1)*j))],
							this.interfaceEigenvalues[2+4*(side+2*(i+(this.nx+1)*j))],
							this.interfaceEigenvalues[3+4*(side+2*(i+(this.nx+1)*j))]);
						var minLambda = Math.min(0, 
							this.interfaceEigenvalues[0+4*(side+2*(i+(this.nx+1)*j))],
							this.interfaceEigenvalues[1+4*(side+2*(i+(this.nx+1)*j))],
							this.interfaceEigenvalues[2+4*(side+2*(i+(this.nx+1)*j))],
							this.interfaceEigenvalues[3+4*(side+2*(i+(this.nx+1)*j))]);
						var dx = this.xi[side + 2 * (i+dirs[side][0] + (this.nx+1) * (j+dirs[side][1]))] 
							- this.xi[side + 2 * (i + (this.nx+1) * j)];
						var dum = dx / (maxLambda - minLambda);
						if (mindum === undefined || dum < mindum) mindum = dum;
					}
				}
			}
			return this.cfl * mindum;
	
		},
		advect : function(dt) {
			for (var j = 1; j < this.nx; ++j) {
				for (var i = 1; i < this.nx; ++i) {
					for (var side = 0; side < 2; ++side) {
						for (var state = 0; state < 4; ++state) {
							//find state change across interface in the basis of the eigenspace at the interface
							var sum = 0;
							for (var k = 0; k < 4; ++k) {
									//reproject into interface eigenspace
								sum += this.interfaceEigenvectorsInverse[state + 4 * (k + 4 * (side + 2 * (i + (this.nx+1) * j)))]
									//flux difference
									* (this.q[k + 4 * (i + this.nx * j)] 
										- this.q[k + 4 * (i - dirs[side][0] + this.nx * (j - dirs[side][1]))])
							}
							this.interfaceDeltaQTilde[state + 4 * (side + 2 * (i + (this.nx+1) * j))] = sum;
						}
					}
				}
			}
			
			//boundary zero
			for (var j = 0; j < this.nghost-1; ++j) {
				for (var i = 0; i <= this.nx; ++i) {
					for (var state = 0; state < 4; ++state) {
						//left boundary, left and top sides, zero vector
						this.interfaceDeltaQTilde[state + 4 * (0 + 2 * (j + (this.nx+1) * i))] = 0;
						//right boundary, left and top sides, zero vector
						this.interfaceDeltaQTilde[state + 4 * (0 + 2 * (this.nx-j + (this.nx+1) * i))] = 0;
						//top boundary, left and top sides, zero vector
						this.interfaceDeltaQTilde[state + 4 * (1 + 2 * (i + (this.nx+1) * j))] = 0;
						//bottom boundary, left and top sides, zero vector
						this.interfaceDeltaQTilde[state + 4 * (1 + 2 * (i + (this.nx+1) * (this.nx-j)))] = 0;
					}
				}
			}

			for (var j = this.nghost; j < this.nx + this.nghost - 3; ++j) {
				for (var i = this.nghost; i < this.nx + this.nghost - 3; ++i) {
					for (var side = 0; side < 2; ++side) {
						for (var state = 0; state < 4; ++state) {
							var interfaceDeltaQTilde = this.interfaceDeltaQTilde[state + 4 * (side + 2 * (i + (this.nx+1) * j))];
							if (Math.abs(interfaceDeltaQTilde) > 0) {
								if (this.interfaceEigenvalues[state + 4 * (side + 2 * (i + (this.nx+1) * j))] > 0) {
									this.rTilde[state + 4 * (side + 2 * (i + (this.nx+1) * j))] = 
										this.interfaceDeltaQTilde[state + 4 * (side + 2 * (i - dirs[side][0] + (this.nx+1) * (j - dirs[side][1])))]
										/ interfaceDeltaQTilde;
								} else {
									this.rTilde[state + 4 * (side + 2 * (i + (this.nx+1) * j))] = 
										this.interfaceDeltaQTilde[state + 4 * (side + 2 * (i + dirs[side][0] + (this.nx+1) * (j + dirs[side][1])))]
										/ interfaceDeltaQTilde;
								}
							} else {
								this.rTilde[state + 4 * (side + 2 * (i + (this.nx+1) * j))] = 0;
							}
						}
					}
				}
			}
	
			//..and keep the boundary rTilde's zero	
			for (var j = 0; j < this.nghost; ++j) {
				for (var i = 0; i <= this.nx; ++i) {
					for (var state = 0; state < 4; ++state) {
						//left
						this.rTilde[state + 4 * (0 + 2 * (j + (this.nx+1) * i))] = 0;
						//right
						this.rTilde[state + 4 * (0 + 2 * (this.nx-j + (this.nx+1) * i))] = 0;
						//bottom
						this.rTilde[state + 4 * (1 + 2 * (i + (this.nx+1) * j))] = 0;
						//top
						this.rTilde[state + 4 * (1 + 2 * (i + (this.nx+1) * (this.nx-j)))] = 0;
					}
				}
			}
		
			var fluxAvg = [];	//4
			var fluxTilde = [];	//4
			var dxi = [];
			//transform cell q's into cell qTilde's (eigenspace)
			for (var j = this.nghost-1; j < this.nx+this.nghost-2; ++j) {
				for (var i = this.nghost-1; i < this.nx+this.nghost-2; ++i) {
					var dx = this.xi[0 + 2 * (i + (this.nx+1) * j)] 
						- this.xi[0 + 2 * (i-dirs[0][0] + (this.nx+1) * (j-dirs[0][1]))];
					var dy = this.xi[1 + 2 * (i + (this.nx+1) * j)] 
						- this.xi[1 + 2 * (i-dirs[1][0] + (this.nx+1) * (j-dirs[1][1]))];
					var volume = dx * dy;
					dxi[0] = dx;
					dxi[1] = dy;
					for (var side = 0; side < 2; ++side) {
						
						//simplification: rather than E * L * E^-1 * q, just do A * q for A the original matrix
						//...and use that on the flux L & R avg (which doesn't get scaled in eigenvector basis space
						for (var state = 0; state < 4; ++state) {
							var sum = 0;
							for (var k = 0; k < 4; ++k) {
								sum += this.interfaceMatrix[state + 4 * (k + 4 * (side + 2 * (i + (this.nx+1) * j)))]
									* (this.q[k + 4 * (i - dirs[side][0] + this.nx * (j - dirs[side][1]))]
										+ this.q[k + 4 * (i + this.nx * j)]);
							}
							fluxAvg[state] = .5 * sum;
						}

						//calculate flux
						for (var state = 0; state < 4; ++state) {
							var theta = 0;
							if (this.interfaceEigenvalues[state + 4 * (side + 2 * (i + (this.nx+1) * j))] >= 0) {
								theta = 1;
							} else {
								theta = -1;
							}
						
							var phi = this.fluxMethod(this.rTilde[state + 4 * (side + 2 * (i + (this.nx+1) * j))]);

							var epsilon = this.interfaceEigenvalues[state + 4 * (side + 2 * (i + (this.nx+1) * j))] * dt / dxi[side];//* volume / (dxi[side] * dxi[side]); 

							var deltaFluxTilde = this.interfaceEigenvalues[state + 4 * (side + 2 * (i + (this.nx+1) * j))]
								* this.interfaceDeltaQTilde[state + 4 * (side + 2 * (i + (this.nx+1) * j))];

							fluxTilde[state] = -.5 * deltaFluxTilde * (theta + phi * (epsilon - theta));
						}
					
						//reproject fluxTilde back into q
						for (var state = 0; state < 4; ++state) {
							var sum = 0;
							for (var k = 0; k < 4; ++k) {
								sum += fluxTilde[k]
									* this.interfaceEigenvectors[state + 4 * (k + 4 * (side + 2 * (i + (this.nx+1) * j)))];
							}
							this.flux[state + 4 * (side + 2 * (i + (this.nx+1) * j))] = fluxAvg[state] + sum;
						}
					}
				}
			}
		
			//zero boundary flux
			//..and keep the boundary r's zero	
			for (var j = 0; j < this.nghost-1; ++j) {
				for (var i = 0; i <= this.nx; ++i) {
					for (var state = 0; state < 4; ++state) {
						//left
						this.flux[state + 4 * (0 + 2 * (j + (this.nx+1) * i))] = 0;
						//right
						this.flux[state + 4 * (0 + 2 * (this.nx-j + (this.nx+1) * i))] = 0;
						//bottom
						this.flux[state + 4 * (1 + 2 * (i + (this.nx+1) * j))] = 0;
						//top
						this.flux[state + 4 * (1 + 2 * (i + (this.nx+1) * (this.nx-j)))] = 0;
					}
				}
			}

			//update cells
			for (var j = this.nghost; j < this.nx-this.nghost; ++j) {
				for (var i = this.nghost; i < this.nx-this.nghost; ++i) {
					var xiIndexR = 0 + 2 * (i + dirs[0][0] + (this.nx+1) * (j + dirs[0][1]));
					var xiIndexL = 0 + 2 * (i + (this.nx+1) * j);
					var dx = this.xi[xiIndexR] - this.xi[xiIndexL];
					
					var xiIndexR = 1 + 2 * (i + dirs[1][0] + (this.nx+1) * (j + dirs[1][1]));
					var xiIndexL = 1 + 2 * (i + (this.nx+1) * j);
					var dy = this.xi[xiIndexR] - this.xi[xiIndexL];
					
					var volume = dx * dy;
					dxi[0] = dx;
					dxi[1] = dy;
					
					for (var side = 0; side < 2; ++side) {
						for (var state = 0; state < 4; ++state) {
							
							var ifluxR = state + 4 * (side + 2 * (i + dirs[side][0] + (this.nx+1) * (j + dirs[side][1])));
							var ifluxL = state + 4 * (side + 2 * (i + (this.nx+1) * j));
							var df = this.flux[ifluxR] - this.flux[ifluxL];
							this.q[state + 4 * (i + this.nx * j)] -= dt * df / dxi[side];//* volume / (dxi[side] * dxi[side]);
						}
					}
				}
			}
		}
	}
};

var HydroState = makeClass({ 
	init : function(args) {
		var thiz = this;

		this.nx = args.size;
		this.cfl =.5;
		this.gamma = args.gamma;

		this.noiseTex = new GL.Texture2D({
			internalFormat : gl.RGBA,
			format : gl.RGBA,
			type : gl.FLOAT,
			width : this.nx,
			height : this.nx,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.CLAMP_TO_EDGE,
				t : gl.CLAMP_TO_EDGE
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

		this.resetSodShader = new GL.ShaderProgram({
			vertexCodeID : 'kernel-vsh',
			vertexPrecision : 'best',
			fragmentCodeID : 'reset-sod-fsh',
			fragmentPrecision : 'best',
			uniforms : {
				randomTex : 0,
				rangeMin : [xmin, ymin],
				rangeMax : [xmax, ymax]
			}
		});

		this.resetWaveShader = new GL.ShaderProgram({
			vertexCodeID : 'kernel-vsh',
			vertexPrecision : 'best',
			fragmentCodeID : 'reset-wave-fsh',
			fragmentPrecision : 'best',
			uniforms : {
				randomTex : 0,
				rangeMin : [xmin, ymin],
				rangeMax : [xmax, ymax]
			}
		});

		this.resetKelvinHemholtzShader = new GL.ShaderProgram({
			vertexCodeID : 'kernel-vsh',
			vertexPrecision : 'best',
			fragmentCodeID : 'reset-kelvin-hemholtz-fsh',
			fragmentPrecision : 'best',
			uniforms : {
				randomTex : 0,
				gamma : this.gamma,
				rangeMin : [xmin, ymin],
				rangeMax : [xmax, ymax]
			}
			//TODO make it periodic on the left/right borders and reflecting on the top/bottom borders	
		});

		this.burgersComputeInterfaceVelocityShader = new GL.ShaderProgram({
			vertexCodeID : 'kernel-vsh',
			vertexPrecision : 'best',
			fragmentCodeID : 'burgers-compute-interface-velocity-fsh',
			fragmentPrecision : 'best',
			uniforms : {
				qTex : 0,
				step : [1/this.nx, 1/this.nx]
			}
		});

		var coordNames = ['x', 'y'];
		this.burgersComputeFluxSlopeShader = [];
		$.each(coordNames, function(i, coordName) {
			thiz.burgersComputeFluxSlopeShader[i] = new GL.ShaderProgram({
				vertexCodeID : 'kernel-vsh',
				vertexPrecision : 'best',
				fragmentCode : 
					$('#burgers-compute-flux-slope-fsh').text().replace(/\$side/g, i),
				fragmentPrecision : 'best',
				uniforms : {
					qTex : 0,
					uiTex : 1,
					step : [1/thiz.nx, 1/thiz.nx]
				}
			});
		});

		this.burgersComputeFluxShader = [];
		$.each(coordNames, function(i, coordName) {
			thiz.burgersComputeFluxShader[i] = new GL.ShaderProgram({
				vertexCodeID : 'kernel-vsh',
				vertexPrecision : 'best',
				fragmentCode : 
					$('#flux-limiter-fsh').text()
					+ $('#burgers-compute-flux-fsh').text().replace(/\$side/g, i),
				fragmentPrecision : 'best',
				uniforms : {
					qTex : 0,
					uiTex : 1,
					rTex : 2,
					step : [1/thiz.nx, 1/thiz.nx]
				}
			});
		});

		this.burgersUpdateStateShader = new GL.ShaderProgram({
			vertexCodeID : 'kernel-vsh',
			vertexPrecision : 'best',
			fragmentCodeID : 'burgers-update-state-fsh',
			fragmentPrecision : 'best',
			uniforms : {
				step : [1/this.nx, 1/this.nx],
				qTex : 0,
				fluxXTex : 1,
				fluxYTex : 2
			}
		});

		this.computePressureShader = new GL.ShaderProgram({
			vertexCodeID : 'kernel-vsh',
			vertexPrecision : 'best',
			fragmentCodeID : 'compute-pressure-fsh',
			fragmentPrecision : 'best',
			uniforms : {
				step : [1/this.nx, 1/this.nx],
				gamma : this.gamma,
				qTex : 0
			}
		});

		this.applyPressureToMomentumShader = new GL.ShaderProgram({
			vertexCodeID : 'kernel-vsh',
			vertexPrecision : 'best',
			fragmentCodeID : 'apply-pressure-to-momentum-fsh',
			fragmentPrecision : 'best',
			uniforms : {
				step : [1/this.nx, 1/this.nx],
				qTex : 0,
				pressureTex : 1
			}
		});
		
		this.applyPressureToWorkShader = new GL.ShaderProgram({
			vertexCodeID : 'kernel-vsh',
			vertexPrecision : 'best',
			fragmentCodeID : 'apply-pressure-to-work-fsh',
			fragmentPrecision : 'best',
			uniforms : {
				step : [1/this.nx, 1/this.nx],
				qTex : 0,
				pressureTex : 1
			}
		});

		this.solidShader = new GL.ShaderProgram({
			vertexCodeID : 'kernel-vsh',
			vertexPrecision : 'best',
			fragmentCodeID : 'solid-fsh',
			fragmentPrecision : 'best',
			uniforms : {
				color : [0,0,0,0]
			}
		});

		this.copyShader = new GL.ShaderProgram({
			vertexCodeID : 'kernel-vsh',
			vertexPrecision : 'best',
			fragmentCodeID : 'copy-fsh',
			fragmentPrecision : 'best',
			uniforms : {
				srcTex : 0,
				offset : [0,0]
			}
		});

		this.fbo = new GL.Framebuffer({
			width : this.nx,
			height : this.nx
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
		this.qTex = new GL.Texture2D({
			internalFormat : gl.RGBA,	//rho, rho * u, rho * v, rho * e
			format : gl.RGBA,
			type : gl.FLOAT,
			width : this.nx,
			height : this.nx,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			}
		});

		this.nextQTex = new GL.Texture2D({
			internalFormat : gl.RGBA,	//rho, rho * u, rho * v, rho * e
			format : gl.RGBA,
			type : gl.FLOAT,
			width : this.nx,
			height : this.nx,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			}
		});

		this.resetSod();
		
		//p_i,j: pressure
		this.pressureTex = new GL.Texture2D({
			internalFormat : gl.RGBA,	//rho, rho * u, rho * v, rho * e
			format : gl.RGBA,
			type : gl.FLOAT,
			width : this.nx,
			height : this.nx,
			minFilter : gl.NEAREST,
			magFilter : gl.NEAREST,
			wrap : {
				s : gl.REPEAT,
				t : gl.REPEAT
			}
		});

		//TODO it is tempting to merge r, f, and ui into an edge structure
		//and associate them with the nodes on either side of them,
		//but then I would lose out on the 2nd-order contributions to the flux limiter.

		//f_{i-1/2},{j-1/2},side,state: cell flux
		this.fluxTex = [];
		for (var side = 0; side < 2; ++side) {
			this.fluxTex[side] = new GL.Texture2D({
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
				}
			});
		}


		//used for Burgers
		
		
		//r_{i-1/2},{j-1/2},side,state	
		this.rTex = [];
		for (var side = 0; side < 2; ++side) {
			this.rTex[side] = new GL.Texture2D({
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
				}
			});
		}
		
		//only used with Burger's eqn advection code
		//u_{i-1/2},{j-1/2},dim: interface velocity
		this.uiTex = new GL.Texture2D({
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
			}
		});


		//used for Riemann
	

		//a_{i-1/2},{j-1/2},side,state,state
		this.interfaceMatrix = new Float32Array((this.nx+1) * (this.nx+1) * 2 * 4 * 4);
		this.interfaceEigenvalues = new Float32Array((this.nx+1) * (this.nx+1) * 2 * 4);
		this.interfaceEigenvectors = new Float32Array((this.nx+1) * (this.nx+1) * 2 * 4 * 4);
		this.interfaceEigenvectorsInverse = new Float32Array((this.nx+1) * (this.nx+1) * 2 * 4 * 4);
		for (var j = 0; j <= this.nx; ++j) {
			for (var i = 0; i <= this.nx; ++i) {
				for (var side = 0; side < 2; ++side) {
					for (var stateJ = 0; stateJ < 4; ++stateJ) {
						for (var stateI = 0; stateI < 4; ++stateI) {
							//initialize to identity matrix
							this.interfaceMatrix[stateI + 4 * (stateJ + 4 * (side + 2 * (i + (this.nx+1) * j)))] = stateI == stateJ ? 1 : 0;
							this.interfaceEigenvectors[stateI + 4 * (stateJ + 4 * (side + 2 * (i + (this.nx+1) * j)))] = stateI == stateJ ? 1 : 0;
							this.interfaceEigenvectorsInverse[stateI + 4 * (stateJ + 4 * (side + 2 * (i + (this.nx+1) * j)))] = stateI == stateJ ? 1 : 0;
						}
						this.interfaceEigenvalues[stateJ + 4 * (side + 2 * (i + (this.nx+1) * j))] = 0;
					}
				}
			}
		}

		//qiTilde_{i-1/2},{j-1/2},side,state	
		this.interfaceDeltaQTilde = new Float32Array((this.nx+1) * (this.nx+1) * 2 * 4);
		for (var j = 0; j <= this.nx; ++j) {
			for (var i = 0; i <= this.nx; ++i) {
				for (var side = 0; side < 2; ++side) {
					for (var state = 0; state < 4; ++state) {
						this.interfaceDeltaQTilde[state + 4 * (side + 2 * (i + (this.nx+1) * j))] = 0;
					}
				}
			}
		}

		//rTilde_{i-1/2},{j-1/2},side,state
		this.rTilde = new Float32Array((this.nx+1) * (this.nx+1) * 2 * 4);
		for (var j = 0; j <= this.nx; ++j) {
			for (var i = 0; i <= this.nx; ++i) {
				for (var side = 0; side < 2; ++side) {
					for (var state = 0; state < 4; ++state) {
						this.rTilde[state + 4 * (side + 2 * (i + (this.nx+1) * j))] = 0;
					}
				}
			}
		}

		//number of ghost cells
		this.nghost = 2;

		//solver configuration
		this.boundaryMethod = boundaryMethods.none;
		this.fluxMethod = fluxMethods.superbee;
		this.advectMethod = advectMethods.Burgers;
	},
	resetSod : function() {
		var thiz = this;
		this.fbo.setColorAttachmentTex2D(0, this.qTex);
		this.fbo.draw({
			callback : function() {
				gl.viewport(0, 0, thiz.nx, thiz.nx);
				GL.unitQuad.draw({
					shader : thiz.resetSodShader,
					uniforms : {
						noiseAmplitude : useNoise ? 0.01 : 0
					},
					texs : [thiz.noiseTex]
				});
			}
		});
	},
	resetWave : function() {
		var thiz = this;
		this.fbo.setColorAttachmentTex2D(0, this.qTex);
		this.fbo.draw({
			callback : function() {
				gl.viewport(0, 0, thiz.nx, thiz.nx);
				GL.unitQuad.draw({
					shader : thiz.resetWaveShader,
					uniforms : {
						noiseAmplitude : useNoise ? 0.01 : 0
					},
					texs : [thiz.noiseTex]
				});
			}
		});
	},
	//http://www.astro.princeton.edu/~jstone/Athena/tests/kh/kh.html
	resetKelvinHemholtz : function() {
		var thiz = this;
		this.fbo.setColorAttachmentTex2D(0, this.qTex);
		this.fbo.draw({
			callback : function() {
				gl.viewport(0, 0, thiz.nx, thiz.nx);
				GL.unitQuad.draw({
					shader : thiz.resetKelvinHemholtzShader,
					uniforms : {
						noiseAmplitude : useNoise ? 0.01 : 0
					},
					texs : [thiz.noiseTex]
				});
			}
		});
	},
	boundary : function() {
		return;
		
		this.boundaryMethod();
	},
	step : function(dt) {
		var thiz = this;
		var dx = (xmax - xmin) / (this.nx - 1);
		var dy = (ymax - ymin) / (this.nx - 1);
		
		//apply boundary conditions
		this.boundary();

		//solve
		this.advectMethod.advect.call(this, dt);

		//boundary again
		this.boundary();

		this.fbo.setColorAttachmentTex2D(0, this.pressureTex);
		this.fbo.draw({
			callback : function() {
				//compute pressure
				gl.viewport(0, 0, thiz.nx, thiz.nx);
				thiz.drawQuad({
					min : [0,0],
					max : [thiz.nx-1, thiz.nx-1],
					shader : thiz.computePressureShader,
					texs : [thiz.qTex]
				});
			}
		});
		
		this.fbo.setColorAttachmentTex2D(0, this.nextQTex);
		this.fbo.draw({
			callback : function() {
				//apply momentum diffusion
				gl.viewport(0, 0, thiz.nx, thiz.nx);
			
				thiz.drawQuad({
					min : [0,0],
					max : [thiz.nx, thiz.nx],
					shader : thiz.copyShader,
					texs : [thiz.qTex]
				});
			
				thiz.drawQuad({
					min : [thiz.nghost, thiz.nghost],
					max : [thiz.nx - 1 - thiz.nghost, thiz.nx - 1 - thiz.nghost],
					shader : thiz.applyPressureToMomentumShader,
					uniforms : {
						dt_dx : [dt / dx, dt / dy]
					},
					texs : [thiz.qTex, thiz.pressureTex]
				});
			}
		});
		this.swapQTexs();

		this.fbo.setColorAttachmentTex2D(0, this.nextQTex);
		this.fbo.draw({
			callback : function() {
				//apply work diffusion
				gl.viewport(0, 0, thiz.nx, thiz.nx);
			
				thiz.drawQuad({
					min : [0,0],
					max : [thiz.nx, thiz.nx],
					shader : thiz.copyShader,
					texs : [thiz.qTex]
				});
				
				thiz.drawQuad({
					min : [thiz.nghost, thiz.nghost],
					max : [thiz.nx - 1 - thiz.nghost, thiz.nx - 1 - thiz.nghost],
					shader : thiz.applyPressureToWorkShader,
					uniforms : {
						dt_dx : [dt / dx, dt / dy]
					},
					texs : [thiz.qTex, thiz.pressureTex]
				});
			}
		});
		this.swapQTexs();

		//last boundary update
		this.boundary();
	},
	update : function() {
		//get timestep
		var dt = this.advectMethod.initStep.call(this);

		//do the update
		this.step(dt);
	},

	/*
	args
		min : min range (inclusive)
		max : max range (inclusive)
	*/
	drawQuad : function(args) {
		GL.unitQuad.draw(args);
		return;
		
		if (this.quadVtxBuf === undefined) {
			this.quadVtxBuf = new GL.ArrayBuffer({
				dim : 2,
				count : 4,
				usage : gl.DYNAMIC_DRAW,
				keep : true
			});
		}
	
		if (this.quad === undefined) {
			this.quad = new GL.SceneObject({
				mode : gl.TRIANGLE_STRIP,
				attrs : {
					vertex : this.quadVtxBuf
				},
				parent : null,
				static : true
			});
		}

		this.quadVtxBuf.data[0] = args.min[0] / this.nx;
		this.quadVtxBuf.data[1] = args.min[1] / this.nx;
		this.quadVtxBuf.data[2] = args.max[0] / this.nx;
		this.quadVtxBuf.data[3] = args.min[1] / this.nx;
		this.quadVtxBuf.data[4] = args.min[0] / this.nx;
		this.quadVtxBuf.data[5] = args.max[1] / this.nx;
		this.quadVtxBuf.data[6] = args.max[0] / this.nx;
		this.quadVtxBuf.data[7] = args.max[1] / this.nx;
		this.quadVtxBuf.updateData();
		this.quad.draw(args);
	},
	drawLine : function(args) {
		if (this.lineVtxBuf === undefined) {
			this.lineVtxBuf = new GL.ArrayBuffer({
				dim : 2,
				count : 2,
				usage : gl.DYNAMIC_DRAW,
				keep : true
			});
			if (this.line === undefined) {
				this.line = new GL.SceneObject({
					mode : gl.LINE_STRIP,
					attrs : {
						vertex : this.lineVtxBuf
					},
					parent : null,
					static : true
				});
			}

			this.lineVtxBuf.data[0] = (args.src[0]+.5) / this.nx;
			this.lineVtxBuf.data[1] = (args.src[1]+.5) / this.nx;
			this.lineVtxBuf.data[2] = (args.dst[0]+.5) / this.nx;
			this.lineVtxBuf.data[3] = (args.dst[1]+.5) / this.nx;
			this.lineVtxBuf.updateData();
			this.line.draw(args);
		}
	},

	swapQTexs : function() {
		//swap
		var tmp = this.qTex;
		this.qTex = this.nextQTex;
		this.nextQTex = this.qTex;
	},

	zeroBorder : function(border, size) {
		return;

		//boundary zero
		//left
		this.drawQuad({
			min : [0, 0],
			max : [border, size],
			shader : this.solidShader
		});
		//right
		this.drawQuad({
			min : [size - border - 1, 0],
			max : [size, size],
			shader : this.solidShader
		});
		//bottom
		this.drawQuad({
			min : [0, 0],
			max : [size, border],
			shader : this.solidShader
		});
		//top
		this.drawQuad({
			min : [0, size - border - 1],
			max : [size, size],
			shader : this.solidShader
		});
	}
});


var Hydro = makeClass({
	init : function() {
		this.state = new HydroState({
			size : 256,	//actually 255, so this.nx is equal to this.nx+1 of my other versions
			gamma : 7/5
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

	//reset viewport
	gl.viewport(0, 0, GL.canvas.width, GL.canvas.height);
	
	//draw
	GL.draw();
	GL.unitQuad.draw({
		shader : drawToScreenShader,
		uniforms : {
			lastMin : hydro.lastDataMin,
			lastMax : hydro.lastDataMax
		},
		texs : [
			currentColorScheme,
			hydro.state.qTex
		]
	});
	
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
		if (hydro.state[key] == map[k]) {
			option.attr('selected', 'true');
		}
	}
	select.change(function() {
		hydro.state[key] = map[select.val()];
	});
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

	//init hydro after gl

	hydro = new Hydro();

	//init controls after hydro
	
	panel = $('#panel');	

	$('#reset-sod').click(function(){ hydro.state.resetSod(); });
	$('#reset-wave').click(function(){ hydro.state.resetWave(); });
	$('#reset-kelvin-hemholtz').click(function(){ hydro.state.resetKelvinHemholtz(); });

	$('#use-noise').change(function() {
		useNoise = $(this).is(':checked');
	});

	buildSelect('boundary', 'boundaryMethod', boundaryMethods);
	buildSelect('flux-limiter', 'fluxMethod', fluxMethods);
	buildSelect('advect-method', 'advectMethod', advectMethods);

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
			[0,0,.5],
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

	drawToScreenShader = new GL.ShaderProgram({
		vertexCodeID : 'draw-to-screen-vsh',
		vertexPrecision : 'best',
		fragmentCodeID : 'draw-to-screen-fsh',
		fragmentPrecision : 'best',
		uniforms : {
			gradientTex : 0,
			qTex : 1
		}
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
});