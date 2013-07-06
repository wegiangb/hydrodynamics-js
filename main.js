/*
1D ADM
2D: Burger at least
2D ADM
2D unstructured
*/

var panel;
var canvas;
var waveVtxBuf, waveStateBuf;
var xmin = 0;
var xmax = 100; 
var ymin = -10;
var ymax = 50;
var gridstep = 10;

function isnan(x) {
	return x != x;
}

function mat33invert(out, a) {
	var det = a[0][0] * a[1][1] * a[2][2]
			+ a[1][0] * a[2][1] * a[0][2]
			+ a[2][0] * a[0][1] * a[1][2]
			- a[2][0] * a[1][1] * a[0][2]
			- a[1][0] * a[0][1] * a[2][2]
			- a[0][0] * a[2][1] * a[1][2];
	if (det == 0) {
		for (var j = 0; j < 3; ++j) {
			for (var i = 0; i < 3; ++i) {
				console.log('a('+i+','+j+') = '+a[j][i]);
			}
		}
		throw 'singular!';
	}
	var invDet = 1 / det;
	for (var j = 0; j < 3; ++j) {
		var j1 = (j + 1) % 3;
		var j2 = (j + 2) % 3;
		for (var i = 0; i < 3; ++i) {
			var i1 = (i + 1) % 3;
			var i2 = (i + 2) % 3;
			out[i][j] = invDet * (a[j1][i1] * a[j2][i2] - a[j1][i2] * a[j2][i1]);
		}
	}
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
function buildEigenstate(matrix, eigenvalues, eigenvectors, eigenvectorsInverse, velocity, hTotal, gamma) {
	//calculate matrix & eigenvalues & vectors at interface from state at interface
	var speedOfSound = Math.sqrt((gamma - 1) * (hTotal - .5 * velocity * velocity));	
	//matrix, listed per column
	matrix[0][0] = 0;
	matrix[0][1] = (gamma - 3) / 2 * velocity * velocity;
	matrix[0][2] = velocity * ((gamma - 1) / 2 * velocity * velocity - hTotal);
	matrix[1][0] = 1;
	matrix[1][1] = (3 - gamma) * velocity;
	matrix[1][2] = hTotal - (gamma - 1) * velocity * velocity;
	matrix[2][0] = 0;
	matrix[2][1] = gamma - 1;
	matrix[2][2] = gamma * velocity;

	//eigenvalues: min, mid, max
	eigenvalues[0] = velocity - speedOfSound;
	eigenvalues[1] = velocity;
	eigenvalues[2] = velocity + speedOfSound;
	//min eigenvector
	eigenvectors[0][0] = 1;
	eigenvectors[0][1] = velocity - speedOfSound;
	eigenvectors[0][2] = hTotal - speedOfSound * velocity;
	//mid eigenvector
	eigenvectors[1][0] = 1;
	eigenvectors[1][1] = velocity;
	eigenvectors[1][2] = .5 * velocity * velocity;
	//max eigenvector
	eigenvectors[2][0] = 1;
	eigenvectors[2][1] = velocity + speedOfSound;
	eigenvectors[2][2] = hTotal + speedOfSound * velocity;
	//calculate eigenvector inverses ... 
	mat33invert(eigenvectorsInverse, eigenvectors);
}

var fluxMethods = {
	upwind : function(r) { return 0; },
	laxWendroff : function(r) { return 1; },
	
	//these two are no good with the Godunov (Riemann) solver
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
	periodic : function(nx,q) {
		q[0][0] = q[nx-4][0];
		q[1][0] = q[nx-3][0];
		q[nx-2][0] = q[2][0];
		q[nx-1][0] = q[3][0];
		q[0][1] = q[nx-4][1];
		q[1][1] = q[nx-3][1];
		q[nx-2][1] = q[2][1];
		q[nx-1][1] = q[3][1];
		q[0][2] = q[nx-4][2];
		q[1][2] = q[nx-3][2];
		q[nx-2][2] = q[2][2];
		q[nx-1][2] = q[3][2];
	},
	mirror : function(nx,q) {
		q[0][0] = q[3][0];
		q[1][0] = q[2][0];
		q[nx-2][0] = q[nx-3][0];
		q[nx-1][0] = q[nx-4][0];
		q[0][1] = -q[3][1];
		q[1][1] = -q[2][1];
		q[nx-2][1] = -q[nx-3][1];
		q[nx-1][1] = -q[nx-4][1];
		q[0][2] = q[3][2];
		q[1][2] = q[2][2];
		q[nx-2][2] = q[nx-3][2];
		q[nx-1][2] = q[nx-4][2];
	},
	dirichlet : function(nx,q) {
		q[0][0] = 0;
		q[1][0] = 0;
		q[nx-2][0] = 0;
		q[nx-1][0] = 0;
		q[0][1] = 0;
		q[1][1] = 0;
		q[nx-2][1] = 0;
		q[nx-1][1] = 0;
		q[0][2] = 0;
		q[1][2] = 0;
		q[nx-2][2] = 0;
		q[nx-1][2] = 0;
	},
	constant : function(nx,q) {
		q[0][0] = q[1][0] = q[2][0];
		q[nx-1][0] = q[nx-2][0] = q[nx-3][0];
		q[0][1] = q[1][1] = q[2][1];
		q[nx-1][1] = q[nx-2][1] = q[nx-3][1];
		q[0][2] = q[1][2] = q[2][2];
		q[nx-1][2] = q[nx-2][2] = q[nx-3][2];
	}
};

//called with 'this' the HydroState
var advectMethods = {
	Burgers : {
		initStep : function() {
			var mindum = undefined;
			for (var i = 0; i < this.nx; ++i) {
				var u = this.q[i][1] / this.q[i][0];
				var energyTotal = this.q[i][2] / this.q[i][0];
				var energyKinematic = .5 * u * u;
				var energyThermal = energyTotal - energyKinematic;
				var speedOfSound = Math.sqrt(this.gamma * (this.gamma - 1) * energyThermal);
				var dum = (this.xi[i+1] - this.xi[i]) / (speedOfSound + Math.abs(u));
				if (mindum === undefined || dum < mindum) mindum = dum;
			}
			if (mindum != mindum) throw 'nan';
			return this.cfl * mindum;
		},
		advect : function(dt) {
			assert(this.x.length == this.nx);
			assert(this.xi.length == this.nx + 1);
			assert(this.q.length == this.nx);
			assert(this.ui.length == this.nx + 1);
		
			//get velocity at interfaces from state
			for (var ix = this.nghost-1; ix < this.nx+this.nghost-2; ++ix) {
				this.ui[ix] = .5 * (this.q[ix][1] / this.q[ix][0] + this.q[ix-1][1] / this.q[ix-1][0]);
			}
			this.ui[0] = this.ui[this.nx] = 0;

			//compute flux and advect for each state vector
			for (var j = 0; j < 3; ++j) {
				//r_{i-1/2} flux limiter
				for (var i = this.nghost; i < this.nx+this.nghost-3; ++i) {
					var dq = this.q[i][j] - this.q[i-1][j];
					if (Math.abs(dq) > 0) {
						if (this.ui[i] >= 0) {
							this.r[i][j] = (this.q[i-1][j] - this.q[i-2][j]) / dq;
						} else {
							this.r[i][j] = (this.q[i+1][j] - this.q[i][j]) / dq;
						}
					} else {
						this.r[i][j] = 0;
					}
				}
				this.r[0][j] = this.r[1][j] = this.r[this.nx-1][j] = this.r[this.nx][j] = 0;

				//construct flux:
				for (var i = this.nghost-1; i < this.nx+this.nghost-2; ++i) {
					//flux limiter
					var phi = this.fluxMethod(this.r[i][j]);
					if (this.ui[i] >= 0) {
						this.flux[i][j] = this.ui[i] * this.q[i-1][j];
					} else {
						this.flux[i][j] = this.ui[i] * this.q[i][j];
					}
					var delta = phi * (this.q[i][j] - this.q[i-1][j]);
					var dx = this.x[i] - this.x[i-1];
					this.flux[i][j] += delta * .5 * Math.abs(this.ui[i]) * (1 - Math.abs(this.ui[i] * dt / dx));
				}
				this.flux[0][j] = this.flux[this.nx][j] = 0;

				//update cells
				for (var i = this.nghost; i < this.nx-this.nghost; ++i) {
					this.q[i][j] -= dt * (this.flux[i+1][j] - this.flux[i][j]) / (this.xi[i+1] - this.xi[i]);
				}
			}
		}
	},
	Riemann : {
		/*
		store eigenvalues and eigenvectors of interfaces
		use the lambdas to calc the DT based on CFL
		*/
		initStep : function() {
			
			//qi[ix] = q_{i-1/2} lies between q_{i-1} = q[i-1] and q_i = q[i]
			//(i.e. qi[ix] is between q[ix-1] and q[ix])
			for (var ix = 1; ix < this.nx; ++ix) {
				//compute Roe averaged interface values
				var densityL = this.q[ix-1][0];
				var densityR = this.q[ix][0];
				var velocityL = this.q[ix-1][1] / densityL;
				var velocityR = this.q[ix][1] / densityR;
				var energyTotalL = this.q[ix-1][2] / densityL;
				var energyTotalR = this.q[ix][2] / densityR;
				
				var energyKinematicL = .5 * velocityL * velocityL;
				var energyThermalL = energyTotalL - energyKinematicL;
				var pressureL = (this.gamma - 1) * densityL * energyThermalL;
				var speedOfSoundL = Math.sqrt(this.gamma * pressureL / densityL);
				var hTotalL = energyTotalL + pressureL / densityL;
				
				var energyKinematicR = .5 * velocityR * velocityR;
				var energyThermalR = energyTotalR - energyKinematicR;
				var pressureR = (this.gamma - 1) * densityR * energyThermalR;
				var speedOfSoundR = Math.sqrt(this.gamma * pressureR / densityR);
				var hTotalR = energyTotalR + pressureR / densityR;
			
				var weightL = Math.sqrt(densityL);
				var weightR = Math.sqrt(densityR);
				var denom = weightL + weightR;

				var velocity = (weightL * velocityL + weightR * velocityR) / denom;
				var hTotal = (weightL * hTotalL + weightR * hTotalR) / denom;

				buildEigenstate(
					this.interfaceMatrix[ix],
					this.interfaceEigenvalues[ix], 
					this.interfaceEigenvectors[ix], 
					this.interfaceEigenvectorsInverse[ix], 
					velocity, hTotal, this.gamma);
			}
		
			var mindum = undefined;
			for (var i = 1; i < this.nx; ++i) {
				var maxLambda = Math.max(0, this.interfaceEigenvalues[i][0], this.interfaceEigenvalues[i][1], this.interfaceEigenvalues[i][2]);
				var minLambda = Math.min(0, this.interfaceEigenvalues[i+1][0], this.interfaceEigenvalues[i+1][1], this.interfaceEigenvalues[i+1][2]);
				var dum = (this.xi[i+1] - this.xi[i]) / (maxLambda - minLambda);
				if (mindum === undefined || dum < mindum) mindum = dum;
			}
			if (mindum != mindum) throw 'nan';
			return this.cfl * mindum;
		},
		/*
		relation:
		
		eigenvalues:
		lambda 1 = u - Cs
		lambda 2 = u
		lambda 3 = u + Cs
		eigenvectors:
		e 1 = (1, u - Cs, h_total - Cs u)
		e 2 = (1, u, .5*u^2)
		e 3 = (1, u + Cs, h_total + Cs u)
		rho = q0
		u = q1 / q0
		h_total = e_total + P / rho
		Cs = sqrt(gamma P / rho)
		*/
		advect : function(dt) {
			//get cell-centered eigenvalues
			//only used for r values at the moment
			//(maybe I can just average left and right?)
			for (var i = 0; i < this.nx; ++i) {
				var density = this.q[i][0];
				var velocity = this.q[i][1] / density;
				var energyTotal = this.q[i][2] / density;
				var energyKinematic = .5 * velocity * velocity;
				var energyThermal = energyTotal - energyKinematic;
				var pressure = (this.gamma - 1) * density * energyThermal;
				var hTotal = energyTotal + pressure / density;
				buildEigenstate(this.matrix[i], this.eigenvalues[i], this.eigenvectors[i], this.eigenvectorsInverse[i], velocity, hTotal, this.gamma);
				for (var j = 0; j < 3; ++j) {
					this.qTilde[i][j] = this.eigenvectorsInverse[i][0][j] * this.q[i][0] 
							+ this.eigenvectorsInverse[i][1][j] * this.q[i][1]
							+ this.eigenvectorsInverse[i][2][j] * this.q[i][2];
				}
			}
			
			/* Method 1 (working): cell eigen based rTildes */
			for (var ix = this.nghost; ix < this.nx+this.nghost-3; ++ix) {
				for (var j = 0; j < 3; ++j) {
					var dqTilde = this.qTilde[ix][j] - this.qTilde[ix-1][j];
					if (Math.abs(dqTilde) > 0) {
						if (this.interfaceEigenvalues[ix][j] >= 0) {
							this.rTilde[ix][j] = (this.qTilde[ix-1][j] - this.qTilde[ix-2][j]) / dqTilde;
						} else {
							this.rTilde[ix][j] = (this.qTilde[ix+1][j] - this.qTilde[ix][j]) / dqTilde;
						}
					}
				}
			}	
			/**/
			/* Method 2 (not working): use q's for rTilde's (instead of qTildes ... to cut out all the eigen stuff at cell centers) * /
			var r = [];
			for (var ix = this.nghost; ix < this.nx+this.nghost-3; ++ix) {
				//first build r_{i-1/2} by the q's on cell boundaries: q_{i-2}, q_{i-1}, q_i, q_{i+1}
				for (var j = 0; j < 3; ++j) {
					var dq = this.q[ix][j] - this.q[ix-1][j];
					if (Math.abs(dq) > 0) {
						if (this.interfaceEigenvalues[ix][j] >= 0) {
							r[j] = (this.q[ix-1][j] - this.q[ix-2][j]) / dq;
						} else {
							r[j] = (this.q[ix+1][j] - this.q[ix][j]) / dq;
						}
					}
				}
				//...then transform it into the eigenvector basis associated with the r (rather than the basis associated with each individual q)
				for (var j = 0; j < 3; ++j) {
					this.rTilde[ix][j] = this.interfaceEigenvectorsInverse[ix][0][j] * r[0] 
						+ this.interfaceEigenvectorsInverse[ix][1][j] * r[1]
						+ this.interfaceEigenvectorsInverse[ix][2][j] * r[2];
				}
			
			}	
			/**/
			//..and keep the boundary r's zero	
			for (var j = 0; j < 3; ++j) {
				this.rTilde[0][j] = this.rTilde[1][j] = this.rTilde[this.nx-1][j] = this.rTilde[this.nx][j] = 0;
			}
			/*
			for (var ix = 0; ix < this.nghost; ++ix) {
				for (var j = 0; j < 3; ++j) {
					this.rTilde[ix][j] = 0;
					this.rTilde[this.nx-ix][j] = 0;
				}	
			}
			*/
			
			//transform cell q's into cell qTilde's (eigenspace)
			// ... so q_{i-1/2}L = q_{i-1}, q_{i-1/2}R = q_i
			// qTilde_{i-1/2}L = E_{i-1/2}^-1 q_{i-1}, qTilde_{i-1/2}R = E_{i-1/2}^-1 q_i
			//use them to detemine qTilde's at boundaries
			//use them (and eigenvalues at boundaries) to determine fTilde's at boundaries
			//use them (and eigenvectors at boundaries) to determine f's at boundaries
			//use them to advect, like good old fluxes advect
			var deltaFluxTilde = [];
			var fluxTilde = [];
			var fluxAvg = [];

			//qi[ix] = q_{i-1/2} lies between q_{i-1} = q[i-1] and q_i = q[i]
			//(i.e. qi[ix] is between q[ix-1] and q[ix])
			for (var ix = 1; ix < this.nx; ++ix) {
				//simplification: rather than E * L * E^-1 * q, just do A * q for A the original matrix
				//...and use that on the flux L & R avg (which doesn't get scaled in eigenvector basis space
				for (var j = 0; j < 3; ++j) {
					fluxAvg[j] = .5 * ( 
						this.interfaceMatrix[ix][0][j] * (this.q[ix-1][0] + this.q[ix][0])
						+ this.interfaceMatrix[ix][1][j] * (this.q[ix-1][1] + this.q[ix][1])
						+ this.interfaceMatrix[ix][2][j] * (this.q[ix-1][2] + this.q[ix][2]));
				}

				//tilde means in basis of eigenvectors
				//flux[ix][k] = fluxTilde[ix][j] * interfaceEigenvectors[ix][k][j]
				for (var j = 0; j < 3; ++j) {
					//flux in eigenvector basis is the q vector transformed by the inverse then scaled by the eigenvalue
					deltaFluxTilde[j] = this.interfaceEigenvalues[ix][j] * (
						this.interfaceEigenvectorsInverse[ix][0][j] * (this.q[ix][0] - this.q[ix-1][0])
						+ this.interfaceEigenvectorsInverse[ix][1][j] * (this.q[ix][1] - this.q[ix-1][1])
						+ this.interfaceEigenvectorsInverse[ix][2][j] * (this.q[ix][2] - this.q[ix-1][2]));
				}
				
				/*
				//using roe averages...
				var densityL = this.q[ix-1][0];
				if (isnan(densityL)) throw 'nan';
				var densityR = this.q[ix][0];
				if (isnan(densityR)) throw 'nan';
				var roeWeightL = Math.sqrt(densityL);
				var roeWeightR = Math.sqrt(densityR);
				var densityRoeAvg = roeWeightL * roeWeightR;
				var velocityL = this.q[ix-1][1] / densityL; 
				var velocityR = this.q[ix][1] / densityR;
				var deltaVelocity = velocityR - velocityL;
				var velocityRoeAvg = (roeWeightL * velocityL + roeWeightR * velocityR) / (roeWeightL + roeWeightR);
				
			
				//...getting negative pressure...
				var energyTotalL = this.q[ix-1][2] / densityL; 
				var energyTotalR = this.q[ix][2] / densityR; 
				var energyKinematicL = .5 * velocityL * velocityL;
				var energyKinematicR = .5 * velocityR * velocityR;
				var energyThermalL = energyTotalL - energyKinematicL;
				var energyThermalR = energyTotalR - energyKinematicR;
				var pressureL = (this.gamma - 1) * densityL * energyThermalL;			
				if (isnan(pressureL)) throw 'nan';
				var pressureR = (this.gamma - 1) * densityR * energyThermalR;			
				if (isnan(pressureR)) throw 'nan';
				var deltaPressure = pressureR - pressureL;	
				if (isnan(deltaPressure)) throw 'nan';
				
				var speedOfSoundL = Math.sqrt(this.gamma * pressureL / densityL);
				if (isnan(speedOfSoundL)) throw 'nan';
				var hTotalL = energyTotalL + pressureL / densityL;
				if (isnan(hTotalL)) throw 'nan';
				var speedOfSoundR = Math.sqrt(this.gamma * pressureR / densityR);
				if (isnan(speedOfSoundR)) throw 'nan';
				var hTotalR = energyTotalR + pressureR / densityR;
				if (isnan(hTotalR)) throw 'nan';
				var speedOfSoundRoeAvg = (roeWeightL * speedOfSoundL + roeWeightR * speedOfSoundR) / (roeWeightL + roeWeightR);
				if (isnan(speedOfSoundRoeAvg)) throw 'nan';
				deltaFluxTilde[0] = (deltaPressure - velocityRoeAvg * speedOfSoundRoeAvg * deltaVelocity) / (2 * speedOfSoundRoeAvg);
				*/

				//calculate flux
				for (var j = 0; j < 3; ++j) {
					var theta = 0;
					if (this.interfaceEigenvalues[ix][j] >= 0) {
						theta = 1;
					} else {
						theta = -1;
					}
					
					var phi = this.fluxMethod(this.rTilde[ix][j]);
					var dx = this.xi[ix] - this.xi[ix-1];
					var epsilon = this.interfaceEigenvalues[ix][j] * dt / dx;
					fluxTilde[j] = -.5 * deltaFluxTilde[j] * (theta + phi * (epsilon - theta));
				}

				//reproject fluxTilde back into q
				for (var j = 0; j < 3; ++j) {
					this.flux[ix][j] = fluxAvg[j]
						+ this.interfaceEigenvectors[ix][0][j] * fluxTilde[0] 
						+ this.interfaceEigenvectors[ix][1][j] * fluxTilde[1] 
						+ this.interfaceEigenvectors[ix][2][j] * fluxTilde[2];
				}

			}
			for (var j = 0; j < 3; ++j) {
				this.flux[0][j] = this.flux[this.nx][j] = 0;
			}

			//update cells
			for (var i = this.nghost; i < this.nx-this.nghost; ++i) {
				for (var j = 0; j < 3; ++j) {
					this.q[i][j] -= dt * (this.flux[i+1][j] - this.flux[i][j]) / (this.xi[i+1] - this.xi[i]);
				}
			}
		}
	}
};

var HydroState = makeClass({ 
	init : function() {
		this.nx = 200;
		this.cfl =.5;
		this.gamma = 7/5;
		var x0 = 0;
		var x1 = 100;
		
		//x_i: cell positions
		this.x = new Float32Array(this.nx);
		for (var i = 0; i < this.nx; ++i) {
			this.x[i] = x0 + (x1 - x0) * i / (this.nx-1);
		}
		
		//x_{i-1/2}: interface positions
		this.xi = new Float32Array(this.nx+1);
		for (var i = 1; i < this.nx+1; ++i) {
			this.xi[i] = .5*(this.x[i] + this.x[i-1]);
		}
		this.xi[0] = 2 * this.xi[1] - this.xi[2];
		this.xi[this.nx] = 2 * this.xi[this.nx-1] - this.xi[this.nx-2]; 

		//q_j,i: state vector, stored as q[j][i]
		//q_0,i: density: rho
		//q_1,i: momentum: rho * v
		//q_2,i: work: rho * e
		this.q = [];
		for (var i = 0; i < this.nx; ++i) {
			this.q[i] = [];
		}

		this.resetSod();
		
		//p_i: pressure
		this.pressure = new Float32Array(this.nx);
	
		//used for Burgers
		//r_{i-1/2}	
		this.r = [];
		for (var i = 0; i < this.nx+1; ++i) {
			this.r[i] = [0,0,0];
		}
		
		//f_{i-1/2}: cell flux
		this.flux = [];
		for (var i = 0; i < this.nx+1; ++i) {
			this.flux[i] = [0,0,0];
		}
		
		//only used with Burger's eqn advection code
		//u_{i-1/2}: interface velocity
		this.ui = new Float32Array(this.nx+1);

		//only used with Riemann eqn advection code:
		//calculated before dt
		// used for dt and for fluxTilde
		this.interfaceMatrix = [];
		this.interfaceEigenvalues = [];	//lambda_{i-1/2},j: interface eigenvalues
		this.interfaceEigenvectors = [];		//e_{i-1/2},j,k: interface eigenvectors
		this.interfaceEigenvectorsInverse = [];		//[e_{i-1/2},j,k]^-1: interface eigenvector column matrix inverse 
		for (var ix = 0; ix < this.nx+1; ++ix) {
			this.interfaceMatrix[ix] = [[1,0,0], [0,1,0], [0,0,1]];
			this.interfaceEigenvalues[ix] = [0, 0, 0];
			this.interfaceEigenvectors[ix] = [[1,0,0], [0,1,0], [0,0,1]];
			this.interfaceEigenvectorsInverse[ix] = [[1,0,0], [0,1,0], [0,0,1]];
		}

		//used for Riemann
		this.rTilde = [];
		for (var i = 0; i < this.nx+1; ++i) {
			this.rTilde[i] = [0,0,0];
		}

		//used for Riemann
		//calculated in advect
		// used for finding r values
		this.qTilde = [];
		this.matrix = [];
		this.eigenvalues = [];
		this.eigenvectors = [];
		this.eigenvectorsInverse = [];
		for (var i = 0; i < this.nx; ++i) {
			this.qTilde[i] = [0,0,0];
			this.matrix[i] = [[1,0,0], [0,1,0], [0,0,1]];
			this.eigenvalues[i] = [0, 0, 0];
			this.eigenvectors[i] = [[1,0,0], [0,1,0], [0,0,1]];
			this.eigenvectorsInverse[i] = [[1,0,0], [0,1,0], [0,0,1]];
		}

		//number of ghost cells
		this.nghost = 2;

		//solver configuration
		this.boundaryMethod = boundaryMethods.mirror;
		this.fluxMethod = fluxMethods.superbee;
		this.advectMethod = advectMethods.Riemann;
	},
	resetSod : function() {
		for (var i = 0; i < this.nx; ++i) {
			this.q[i][0] = (this.x[i] < 30) ? 1 : .1;
			this.q[i][1] = 0 * this.q[i][0];
			this.q[i][2] = 1 * this.q[i][0];
		}
	},
	resetWave : function() {
		var x0 = this.x[0];
		var x1 = this.x[this.nx-1];
		var xmid = .5 * (x0 + x1);
		var dg = .1 * (x1 - x0);
		for (var i = 0; i < this.nx; ++i) {
			this.q[i][0] = 1 + .3 * Math.exp(-Math.pow((this.x[i]-xmid)/dg,2));
			this.q[i][1] = 0 * this.q[i][0];
			this.q[i][2] = 1 * this.q[i][0];
		}
	},
	boundary : function() {
		this.boundaryMethod(this.nx, this.q);
	},
	step : function(dt) {
		
		//apply boundary conditions
		this.boundary();
	
		//solve
		this.advectMethod.advect.call(this, dt);
			
		//boundary again
		this.boundary();

		//compute pressure
		for (var i = 0; i < this.nx; ++i) {
			var u = this.q[i][1] / this.q[i][0];
			var energyTotal = this.q[i][2] / this.q[i][0];
			var energyKinematic = .5 * u * u;
			var energyThermal = energyTotal - energyKinematic;
			this.pressure[i] = (this.gamma - 1) * this.q[i][0] * energyThermal;
		}
		
		//apply momentum diffusion =pressure
		for (var i = this.nghost; i < this.nx-this.nghost; ++i) {
			this.q[i][1] -= dt * (this.pressure[i+1] - this.pressure[i-1]) / (this.x[i+1] - this.x[i-1]);
		}

		//apply work diffusion = momentum
		for (var i = this.nghost; i < this.nx-this.nghost; ++i) {
			//perhaps ui isn't the best use for velocit here?
			//perhaps we could derive something from the state variables?
			var u_inext = this.q[i+1][1] / this.q[i+1][0];
			var u_iprev = this.q[i-1][1] / this.q[i-1][0];
			this.q[i][2] -= dt * (this.pressure[i+1] * u_inext - this.pressure[i-1] * u_iprev) / (this.x[i+1] - this.x[i-1]);
		}
	
		//last boundary update
		this.boundary();
	},
	update : function() {
		//get timestep
		var dt = this.advectMethod.initStep.call(this);

		//do the update
		this.step(dt);
	}
});


var Hydro = makeClass({
	init : function() {
		this.state = new HydroState();
	
		//geometry
		this.vertexPositions = new Float32Array(4*this.state.nx);
		this.vertexStates = new Float32Array(6*this.state.nx);
	},
	update : function() {
		//todo adm or something
		//update a copy of the grid and its once-refined
		//...and a once-unrefined ... over mergeable cells only?
		//then test for errors and split when needed
		this.state.update();
	
		//update geometry
		var x = this.state.x;
		var q = this.state.q;
		var nx = this.state.nx;
		for (var i = 0; i < nx; ++i) {
			this.vertexPositions[0+4*i] = x[i];
			this.vertexPositions[1+4*i] = q[i][0]*15;
			this.vertexPositions[2+4*i] = x[i];
			this.vertexPositions[3+4*i] = 0;
			this.vertexStates[0+6*i] = 1;
			this.vertexStates[1+6*i] = 1;
			this.vertexStates[2+6*i] = 1;
			this.vertexStates[3+6*i] = q[i][0];
			this.vertexStates[4+6*i] = Math.abs(q[i][1] / q[i][0]);
			this.vertexStates[5+6*i] = q[i][2] / q[i][0];
		}
	}
});

var hydro = new Hydro();

function update() {
	//iterate
	hydro.update();
	waveVtxBuf.updateData(hydro.vertexPositions);
	waveStateBuf.updateData(hydro.vertexStates);
	//draw
	GL.draw();
	requestAnimFrame(update);
}

function onresize() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	//factor out aspectratio from fovY (thus making it fovX)
	var aspectRatio = canvas.width / canvas.height;
	GL.view.fovY = .5 * (xmax - xmin) / aspectRatio;
	GL.view.pos[1] = (ymax + ymin) / 2 / aspectRatio;
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

$(document).ready(function(){
	panel = $('#panel');	

	$('#reset-sod').click(function(){ hydro.state.resetSod(); });
	$('#reset-wave').click(function(){ hydro.state.resetWave(); });

	buildSelect('boundary', 'boundaryMethod', boundaryMethods);
	buildSelect('flux-limiter', 'fluxMethod', fluxMethods);
	buildSelect('advect-method', 'advectMethod', advectMethods);

	canvas = $('<canvas>', {
		css : {
			left : 0,
			top : 0,
			position : 'absolute'
		}
	}).prependTo(document.body).get(0);
	$(canvas).disableSelection()
	
	try {
		gl = GL.init(canvas);
	} catch (e) {
		panel.remove();
		$(canvas).remove();
		$('#webglfail').show();
		throw e;
	}

	GL.view.ortho = true;
	GL.view.zNear = -1;
	GL.view.zFar = 1;
	GL.view.pos[0] = (xmax + xmin) / 2;
	GL.view.pos[1] = (ymax + ymin) / 2;
	
	var plainShader = new GL.ShaderProgram({
		vertexCodeID : 'plain-vsh',
		fragmentCodeID : 'plain-fsh',
		uniforms : {
			color : [1,1,1,1]
		}
	});

	//make static grid
	var grid = [];
	for (var i = xmin; i < xmax; i += gridstep) {
		grid.push(i);
		grid.push(ymin);
		grid.push(i);
		grid.push(ymax);
	}
	for (var j = ymin; j < ymax; j += gridstep) {
		grid.push(xmin);
		grid.push(j);
		grid.push(xmax);
		grid.push(j);
	}
	new GL.SceneObject({
		mode : gl.LINES,
		attrs : {
			vertex : new GL.ArrayBuffer({data:grid, dim:2})
		},
		shader : plainShader,
		uniforms : {
			color : [.5,.5,.5,1]
		}
	});

	//make grid
	waveVtxBuf = new GL.ArrayBuffer({
		dim : 2,
		data : hydro.vertexPositions,
		usage : gl.DYNAMIC_DRAW
	});
	waveStateBuf = new GL.ArrayBuffer({
		dim : 3,
		data : hydro.vertexStates,
		usage : gl.DYNAMIC_DRAW
	});
	new GL.SceneObject({
		mode : gl.TRIANGLE_STRIP,
		attrs : {
			vertex : waveVtxBuf,
			state : waveStateBuf
		},
		shader : new GL.ShaderProgram({
			vertexCodeID : 'water-vsh',
			fragmentCodeID : 'water-fsh'
		})
	});

	//start it off
	onresize();
	update();
});
