"use strict";

// The whole scene (paper, smoke, flames, impact) is painted by one shader,
// inside a circle with a transparent surround.
globalThis.limboScene = (() => {
  const VERT = `
attribute vec2 pos; varying vec2 v;
void main(){ v = vec2(pos.x*.5+.5, .5-pos.y*.5); gl_Position = vec4(pos,0.,1.); }`;

  const FRAG = `
precision highp float;
varying vec2 v;
uniform sampler2D bodyTex, pageTex;
uniform vec2 res, face, look;
uniform vec4 ripple;                 // x, y, radius, strength
uniform float radius, size, time, zoom, iris, intro, suck, power, gulp, implode, impact, ghost, rage, blank, might, blood;

float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
float fbm(vec2 p){ return noise(p)*.55 + noise(p*2.1+7.)*.3 + noise(p*4.3+3.)*.15; }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

vec4 logo(vec2 q){
  vec2 uv = q*.5+.5;
  if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) return vec4(0.);
  return texture2D(bodyTex, uv);
}

const vec2 HEAD = vec2(-.0203,-.1898); // centre of the face in logo space

void main(){
  vec2 raw = v*res;
  vec2 cd = raw-res*.5;
  float cr = max(.5,length(cd));
  vec2 px = face + (raw-face)/zoom;

  // Ripple: shockwave and pokes
  vec2 rp = px-ripple.xy;
  float w = length(rp)-ripple.z;
  float ring = exp(-w*w/240.)*ripple.w;
  px -= rp/max(1.,length(rp))*ring*11.;

  vec2 d = px-face;
  float r = max(.5,length(d));

  // ---- The circle itself; its rim burns while Limbo feeds
  float rim = radius*iris + (fbm(cd/cr*3.2+vec2(0.,time*1.5))-.5)*13.*power*(1.-implode);
  float A = smoothstep(.8,-.8,cr-rim);

  // ---- The void: slow smoke
  float sm = fbm(px*.016 + vec2(time*.05,time*.17) + fbm(px*.03-time*.06)*1.3);
  float smoke = smoothstep(.40,.86,sm);
  vec3 col = vec3(.018) + mix(vec3(.14,.135,.13),vec3(.34,.035,.02),rage)*smoke*(.65+.5*power);
  col += vec3(.16,.02,.015)*power*(1.-implode)*smoothstep(.45,.8,sm);
  float moon = exp(-max(0.,length(d-vec2(0.,size*.095))-size*.42)/20.);
  col += vec3(.20,.19,.185)*moon*(1.-implode)*smoothstep(0.,.4,intro);

  // ---- The history page drains into the face
  float Q = suck*25000.;
  float r0 = sqrt(r*r+Q);
  float tw = 1.6*log(1.+Q/(r*r+1500.));
  vec2 p0 = face + rot(tw)*(d/r)*r0;
  float de = radius-length(p0-res*.5);
  float burn = de - (fbm(p0*.055+vec2(0.,time*.5))*24.-5.)*smoothstep(0.,.3,suck);
  float pageA = suck<=0. ? 1. : smoothstep(0.,1.4,burn);
  vec3 page = texture2D(pageTex, clamp(p0/res,0.,1.)).rgb;
  page = mix(page, vec3(.898), blank*smoothstep(radius,radius*.62,length((cd)*vec2(.8,1.25))));
  float depth = clamp((r0-r)/150.,0.,1.);
  page *= 1.-.62*depth*smoothstep(160.,40.,r);
  page *= 1.-.25*smoothstep(.45,.8,noise(vec2(log(r0)*9.,atan(p0.y-face.y,p0.x-face.x)*3.)))*depth;
  float edge = smoothstep(.0,.12,suck);
  page = mix(page, vec3(.03,.025,.025), smoothstep(12.,2.,burn+fbm(p0*.17)*7.-3.)*edge);
  page += vec3(.85,.13,.07)*smoothstep(4.2,.4,burn)*edge;
  col = mix(col,page,pageA);

  // Vignette, and a thin rim light so the circle reads on dark pages
  float dark = smoothstep(0.,.3,suck);
  col *= 1.-.4*smoothstep(.55,1.,cr/radius)*dark;
  col += mix(vec3(.30,.29,.285),vec3(.5,.06,.04),max(rage,power*.7*(1.-implode)))
       * smoothstep(rim-3.2,rim-.8,cr)*dark*(1.-ghost*.55);

  // ---- Limbo
  vec2 q = d/(size*.5);
  float rh = max(.001,length(q));
  float I = implode*implode*2.1;
  float rq = sqrt(rh*rh+I);
  q = rot(1.3*log(1.+I/(rh*rh+.05)))*(q/rh)*rq;
  float loose = smoothstep(.27,.6,rq);             // the face stays whole
  q = rot(power*.07*sin(time*2.3)*smoothstep(.5,.95,rq))*q;
  vec2 p = HEAD+q;
  vec2 n = vec2(fbm(p*3.4+vec2(0.,time*1.5)), fbm(p*3.4+vec2(9.,time*1.3)))-.5;
  vec2 off = n*(.014+(.12+.07*might)*power+.05*gulp)*loose;
  off.y += abs(n.x)*.13*power*loose;               // flames lick upward
  vec4 b = logo(p+off);
  vec4 b2 = logo(p+off*1.6+vec2(0.,.012)*power);
  float diff = abs(dot(b.rgb,vec3(.333))-dot(b2.rgb,vec3(.333)))*loose;
  b.rgb = mix(b.rgb, vec3(.74,.10,.06)*b.a, clamp(diff*power*1.25*smoothstep(1.12,.4,rq),0.,.9));

  // Blood moon: the light inside turns red
  float lb = dot(b.rgb,vec3(.333));
  b.rgb = mix(b.rgb, vec3(.95,.10,.06)*lb*lb + vec3(.25,.0,.0)*lb, blood*loose*.94);

  // Arrives like a drop of ink: black bleeds first, light follows
  float front = rq + (fbm(p*4.2)-.5)*.75;
  float wet = smoothstep(0.,.07, intro*2.1-front);
  float lit = smoothstep(.15,.75, intro*2.6-.55-front);
  b *= wet*smoothstep(0.,.06,intro);
  b.rgb *= lit;
  b *= 1.-smoothstep(.985,1.,implode);
  col = col*(1.-b.a)+b.rgb;
  A = max(A,b.a);

  // ---- The ghost fire left in the dark
  if(ghost>.001){
    vec2 g = (d-look*.4)/(size*.5);
    float gh = length(g);
    vec2 gp = HEAD+g;
    float gl = smoothstep(.24,.55,gh);
    float calmRim = 1.-.75*smoothstep(.68,.86,length(gp));
    vec2 gn = vec2(fbm(gp*3.2+vec2(0.,time*1.1)), fbm(gp*3.2+vec2(5.,time*.9)))-.5;
    vec2 go = gn*(.13+.07*might)*gl*calmRim; go.y += abs(gn.x)*(.17+.14*might)*gl*calmRim;
    vec4 s = logo(gp+go);
    float lum = dot(s.rgb,vec3(.333));
    // Clear the chest, where the words go
    float words = smoothstep(.16,.36,gp.y)*(1.-smoothstep(.74,.9,length(gp)));
    float mask = smoothstep(.26,.36,gh)*(1.-.94*words)*smoothstep(1.25,.5,gh+gp.y*.12);
    float rimGlow = smoothstep(.72,.84,length(gp));
    col = mix(col, vec3(.012), ghost*s.a*(1.-smoothstep(.1,.45,lum))*.92);
    col = mix(col, vec3(.02), ghost*words*.7);
    col += lum*max(mask,rimGlow*.55)*ghost*mix(vec3(.60,.585,.575),vec3(.58,.06,.035),rage)*(.38+.9*smoke+.3*sm);
    // Grown Limbos smoulder along the edges of the fire
    vec4 s2 = logo(gp+go*1.5+vec2(.0,.018));
    float ember = abs(lum-dot(s2.rgb,vec3(.333)))*gl*(1.-.9*words);
    col += vec3(.95,.16,.06)*ember*ghost*max(might*(.55+.6*smoke),blood*.8);
    col = mix(col, vec3(1.25,.12,.07)*dot(col,vec3(.333)), blood*ghost*.85*smoothstep(.25,.4,gh));
    A = max(A, s.a*ghost*iris*iris*smoothstep(rim+34.,rim+14.,cr));
  }
  col += mix(vec3(.5),vec3(.7,.1,.06),rage)*ring*.22*(1.-pageA);

  // ---- One impact frame: negative, speed lines, spikes past the rim
  if(impact>.001){
    vec2 dir = d/r;
    float l = noise(dir*15.+floor(time*24.)*3.)*.75 + noise(dir*40.+9.)*.35;
    float lines = smoothstep(.53,.60,l+.16*smoothstep(50.,170.,r))*smoothstep(38.,80.,r+l*40.);
    col = mix(col, vec3(.93)*(1.-lines), impact);
    A = mix(A, smoothstep(1.,-1.,cr-(radius-12.+l*34.)), impact);
  }

  col += (hash(floor(raw*1.5)+fract(time)*91.)-.5)*.032;

  // Soft shadow so it floats above the page
  float shadow = .42*exp(-max(0.,cr-rim)/8.)*smoothstep(0.,.5,iris)*smoothstep(res.x*.5,res.x*.5-12.,cr);
  gl_FragColor = vec4(clamp(col,0.,1.)*A, A+(1.-A)*shadow);
}`;

  const UNIFORMS = ["radius", "size", "time", "zoom", "iris", "intro", "suck", "power",
    "gulp", "implode", "impact", "ghost", "rage", "blank", "might", "blood"];

  // Returns { draw, dispose }, or null when WebGL is unavailable.
  return function createScene(canvas, width, height, body, page) {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) return null;

    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error("Limbo shader:", gl.getShaderInfoLog(s));
        return null;
      }
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, "pos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    // Both sources are already premultiplied or opaque.
    const texture = (unit, image, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    };
    texture(0, body, "bodyTex");
    texture(1, page, "pageTex");

    const at = (name) => gl.getUniformLocation(prog, name);
    const u = Object.fromEntries(UNIFORMS.map((n) => [n, at(n)]));
    const uFace = at("face"), uLook = at("look"), uRipple = at("ripple");
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(at("res"), width, height);

    return {
      draw(s) {
        for (const n of UNIFORMS) gl.uniform1f(u[n], s[n]);
        gl.uniform2f(uFace, s.face.x, s.face.y);
        gl.uniform2f(uLook, s.look.x, s.look.y);
        gl.uniform4f(uRipple, s.ripple.x, s.ripple.y, s.ripple.r, s.ripple.k);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose() {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      },
    };
  };
})();
