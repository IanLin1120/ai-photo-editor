/* ================= 影像引擎（WebGL2） =================
   管線：P1 幾何+白平衡+曝光 → P2 雜色減少 → P3 細節模糊 → P4 色調/色彩 → P5 遮色片(逐一) → P6 銳化/暈影/顆粒
   預覽與全解析度分塊匯出共用同一組著色器，確保所見即所得。 */
const Engine = (() => {
  'use strict';
  let gl = null, canvas = null, HF = false, maxTex = 4096;
  const P = {}; // programs
  const pool = {};
  const LUMA = [0.2126, 0.7152, 0.0722];

  /* ---------- GLSL ---------- */
  const VS = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;
  const HEAD = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
out vec4 o;
uniform vec2 uOutOrigin,uOutSize,uWork;uniform float uSigma;
const vec3 LUMA=vec3(0.2126,0.7152,0.0722);
vec3 s2l(vec3 c){c=max(c,vec3(0.0));return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(0.04045,c));}
vec3 l2s(vec3 c){c=max(c,vec3(0.0));return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(0.0031308,c));}
float s2l1(float c){c=max(c,0.0);return c<0.04045?c/12.92:pow((c+0.055)/1.055,2.4);}
float l2s1(float c){c=max(c,0.0);return c<0.0031308?c*12.92:1.055*pow(c,1.0/2.4)-0.055;}
vec3 rgb2hsv(vec3 c){vec4 K=vec4(0.0,-1.0/3.0,2.0/3.0,-1.0);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);float e=1.0e-10;return vec3(abs(q.z+(q.w-q.y)/(6.0*d+e)),d/(q.x+e),q.x);}
vec3 hsv2rgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(1.0,2.0/3.0,1.0/3.0))*6.0-3.0);return c.z*mix(vec3(1.0),clamp(p-1.0,0.0,1.0),c.y);}
vec3 wbGain(float t,float m){vec3 g=vec3(exp(0.36*t),exp(-0.24*m),exp(-0.36*t));return g/dot(g,LUMA);}
/* 幾何：輸出座標 → 原圖座標 */
uniform vec4 uCrop;uniform vec2 uBSize;uniform float uBD;uniform mat3 uInvT;uniform int uRot90;uniform vec2 uFlip;uniform vec2 uSSize;uniform float uSD,uDistK;
uniform int uLM;uniform vec3 uLK;uniform float uLU,uLAmt,uLZ;
vec2 lensDist(vec2 s){if(uLM==0)return s;vec2 p=(s-0.5)*uSSize;float r=length(p)/uLU;float f;
  if(uLM==1)f=uLK.x*r*r*r+uLK.y*r*r+uLK.z*r+1.0-uLK.x-uLK.y-uLK.z;else if(uLM==2)f=1.0-uLK.x+uLK.x*r*r;else f=1.0+uLK.x*r*r+uLK.y*r*r*r*r;
  return 0.5+p*mix(1.0,f,uLAmt)/uSSize;}
vec2 outToSrc(vec2 pn){
  vec2 t=uCrop.xy+pn*uCrop.zw;vec2 c=(t-0.5)*uBSize/uBD;vec3 h=uInvT*vec3(c,1.0);c=h.xy/h.z;vec2 b=c*uBD/uBSize+0.5;
  if(uFlip.x>0.5)b.x=1.0-b.x;if(uFlip.y>0.5)b.y=1.0-b.y;
  vec2 s=b;if(uRot90==1)s=vec2(b.y,1.0-b.x);else if(uRot90==2)s=1.0-b;else if(uRot90==3)s=vec2(1.0-b.y,b.x);
  s=0.5+(s-0.5)*(uLZ>0.0?uLZ:1.0);s=lensDist(s);vec2 d=(s-0.5)*uSSize/uSD;float r2=dot(d,d);return 0.5+(s-0.5)*(1.0+uDistK*r2);
}
vec2 PN(){return (uOutOrigin+gl_FragCoord.xy)/uOutSize;}
vec2 TC(){return gl_FragCoord.xy/uWork;}
`;

  const FS_DEVELOP = HEAD + `
uniform sampler2D uSrc,uSrcDn;uniform float uAi;uniform vec4 uSrcRect;uniform vec3 uGain;uniform float uVigCorr;
uniform int uTcaOn;uniform vec4 uTca;uniform vec2 uTca2;uniform vec3 uLV;uniform float uLVU,uLVAmt;
uniform sampler2D uSkyM,uSkyR;uniform int uSkyOn;uniform vec4 uSkyBox,uSkyP,uSkyQ;uniform vec3 uSkyT,uSkyAvg;
uniform int uBicubic;
/* Catmull-Rom 雙三次取樣（9 次雙線性取樣）：重新取樣（鏡頭校正、拉正、旋轉）時比雙線性銳利，匯出與 100% 檢視使用 */
vec4 texCR(sampler2D tex,vec2 uv){vec2 ts=vec2(textureSize(tex,0));vec2 sp=uv*ts;vec2 tp=floor(sp-0.5)+0.5;vec2 f=sp-tp;
  vec2 w0=f*(-0.5+f*(1.0-0.5*f)),w1=1.0+f*f*(-2.5+1.5*f),w2=f*(0.5+f*(2.0-1.5*f)),w3=f*f*(-0.5+0.5*f);vec2 w12=w1+w2;vec2 t0=(tp-1.0)/ts,t3=(tp+2.0)/ts,t12=(tp+w2/w12)/ts;
  vec4 r=texture(tex,vec2(t0.x,t0.y))*w0.x*w0.y+texture(tex,vec2(t12.x,t0.y))*w12.x*w0.y+texture(tex,vec2(t3.x,t0.y))*w3.x*w0.y
        +texture(tex,vec2(t0.x,t12.y))*w0.x*w12.y+texture(tex,vec2(t12.x,t12.y))*w12.x*w12.y+texture(tex,vec2(t3.x,t12.y))*w3.x*w12.y
        +texture(tex,vec2(t0.x,t3.y))*w0.x*w3.y+texture(tex,vec2(t12.x,t3.y))*w12.x*w3.y+texture(tex,vec2(t3.x,t3.y))*w3.x*w3.y;
  return clamp(r,0.0,1.0);}
vec4 smp(vec2 s){vec2 tc=(s-uSrcRect.xy)/uSrcRect.zw;vec4 c=uBicubic==1?texCR(uSrc,tc):texture(uSrc,tc);if(uAi>0.0)c.rgb=mix(c.rgb,(uBicubic==1?texCR(uSrcDn,tc):texture(uSrcDn,tc)).rgb,uAi);return c;}
void main(){
  vec2 s=outToSrc(PN());
  if(s.x<0.0||s.y<0.0||s.x>1.0||s.y>1.0){o=vec4(0.0);return;}
  vec4 c=smp(s);
  if(uTcaOn==1){vec2 p=(s-0.5)*uSSize;float r=length(p)/uLU;float fr=uTca.x+uTca.z*r+uTca2.x*r*r,fb=uTca.y+uTca.w*r+uTca2.y*r*r;
    c.r=smp(0.5+(s-0.5)*fr).r;c.b=smp(0.5+(s-0.5)*fb).b;}
  vec3 l=s2l(c.rgb);vec2 d=(s-0.5)*uSSize/uSD;l*=1.0+uVigCorr*dot(d,d);
  if(uLVAmt>0.0){float r=length((s-0.5)*uSSize)/uLVU;float r2=r*r;float v=1.0+uLV.x*r2+uLV.y*r2*r2+uLV.z*r2*r2*r2;l*=mix(1.0,1.0/max(v,0.05),uLVAmt);}
  /* 天空置換：低解析度天空遮罩 × 原圖亮度細化邊緣（樹梢、建築輪廓） */
  if(uSkyOn==1){
    float m=texture(uSkyM,clamp(s,0.0,1.0)).r;float L=dot(c.rgb,LUMA);
    float th=uSkyP.x-0.14*uSkyP.y;float soft=0.015+0.14*uSkyP.z;
    float w=smoothstep(0.12-0.1*uSkyP.y,0.6-0.25*uSkyP.y,m)*smoothstep(th-soft,th+soft*0.35,L)*uSkyP.w;
    vec2 u=vec2((s.x-uSkyBox.x)/uSkyBox.z,(s.y-uSkyBox.y)/uSkyBox.w);if(uSkyQ.z>0.5)u.x=1.0-u.x;
    vec3 r=s2l(texture(uSkyR,clamp(u,vec2(0.002),vec2(0.998))).rgb)*uSkyQ.x*uSkyT;
    r=mix(r,max(l,r*0.6),uSkyQ.y*smoothstep(0.5,1.05,u.y));
    l=mix(l,r,w);l*=mix(vec3(1.0),uSkyAvg,uSkyQ.w*(1.0-w));
  }
  o=vec4(l*uGain,max(c.a,0.004));
}`;

  /* 傳統雜色減少：亮度雙邊濾波 + 色度引導平滑 */
  const FS_NR = HEAD + `
uniform sampler2D uA;uniform vec4 uNR;uniform vec3 uCNR; // lum,detail,contrast,- ; color,detail,smooth
vec3 toY(vec3 l){vec3 p=l2s(l);float y=dot(p,LUMA);return vec3(y,(p.b-y)*0.5389,(p.r-y)*0.635);}
vec3 fromY(vec3 q){float r=q.x+q.z/0.635;float b=q.x+q.y/0.5389;float g=(q.x-0.2126*r-0.0722*b)/0.7152;return s2l(vec3(r,g,b));}
void main(){
  vec2 tc=TC();vec4 c=texture(uA,tc);if(c.a==0.0){o=c;return;}
  vec3 q=toY(c.rgb);vec2 px=1.0/uWork;
  float Yo=q.x;
  if(uNR.x>0.0){
    float R=clamp((1.5+uNR.x*4.5)*uSigma,0.0,6.0);
    if(R>=0.75){
      float st=max(1.0,floor(R/3.0));int n=int(ceil(R/st));
      float sY=mix(0.012,0.09,uNR.x)*mix(1.0,0.45,uNR.y);float sd=R*0.6+0.5;
      float acc=0.0,wsum=0.0;
      for(int j=-6;j<=6;j++){if(abs(j)>n)continue;for(int i=-6;i<=6;i++){if(abs(i)>n)continue;
        vec2 off=vec2(float(i),float(j))*st;float y=dot(l2s(texture(uA,tc+off*px).rgb),LUMA);
        float dy=y-q.x;float w=exp(-dy*dy/(2.0*sY*sY)-dot(off,off)/(2.0*sd*sd));acc+=y*w;wsum+=w;}}
      float yf=acc/wsum;q.x=yf+(q.x-yf)*uNR.z*0.35;
    }
  }
  if(uCNR.x>0.0){
    float R=clamp((2.0+uCNR.x*22.0)*mix(0.7,1.4,uCNR.z)*uSigma,0.0,40.0);
    if(R>=0.75){
      float st=max(1.0,floor(R/3.0));int n=int(ceil(R/st));
      float sY=mix(0.04,0.2,uCNR.x)*mix(1.0,0.4,uCNR.y);float sd=R*0.7+0.5;
      vec2 acc=vec2(0.0);float wsum=0.0;
      for(int j=-6;j<=6;j++){if(abs(j)>n)continue;for(int i=-6;i<=6;i++){if(abs(i)>n)continue;
        vec2 off=vec2(float(i),float(j))*st;vec3 s=toY(texture(uA,tc+off*px).rgb);
        float dy=s.x-Yo;float w=exp(-dy*dy/(2.0*sY*sY)-dot(off,off)/(2.0*sd*sd));acc+=s.yz*w;wsum+=w;}}
      q.yz=mix(q.yz,acc/wsum,clamp(uCNR.x*1.6,0.0,1.0));
    }
  }
  o=vec4(fromY(q),c.a);
}`;

  /* 分離式高斯/最小值濾波：R、G 為高斯（σ），B 可為高斯或最小值 */
  const FS_SEP = HEAD + `
uniform sampler2D uIn;uniform vec2 uDir;uniform vec3 uSig;uniform int uMinB;uniform int uFromLin;
vec4 fetchV(vec2 tc){vec4 c=texture(uIn,tc);if(uFromLin==1){vec3 p=l2s(c.rgb);float y=dot(p,LUMA);return vec4(y,y,min(p.r,min(p.g,p.b)),1.0);}return c;}
void main(){
  vec2 tc=TC();vec2 px=uDir/uWork;vec4 c0=fetchV(tc);
  vec3 acc=c0.rgb;vec3 ws=vec3(1.0);float mn=c0.b;
  float smax=max(uSig.x,max(uSig.y,uSig.z));int n=int(min(ceil(smax*3.0),24.0));
  for(int i=1;i<=24;i++){if(i>n)break;float fi=float(i);
    vec4 a=fetchV(tc+px*fi),b=fetchV(tc-px*fi);
    vec3 w=vec3(uSig.x>0.0?exp(-fi*fi/(2.0*uSig.x*uSig.x)):0.0,uSig.y>0.0?exp(-fi*fi/(2.0*uSig.y*uSig.y)):0.0,uSig.z>0.0?exp(-fi*fi/(2.0*uSig.z*uSig.z)):0.0);
    acc+=(a.rgb+b.rgb)*w;ws+=2.0*w;if(fi<=uSig.z)mn=min(mn,min(a.b,b.b));}
  vec3 r=acc/ws;if(uMinB==1)r.b=mn;o=vec4(r,1.0);
}`;

  /* 主色調/色彩 */
  const FS_MAIN = HEAD + `
uniform sampler2D uB,uT,uGuide,uLut;uniform int uHasT;
uniform vec4 uTone;uniform float uBlacks,uRoll;uniform vec4 uFx; // con,hl,sh,wh ; clarity,texture,dehaze,fade
uniform vec3 uAtm;uniform float uVib,uSat;
uniform vec4 uHH[2],uHS[2],uHL[2],uBW[2];uniform int uMono;
uniform vec4 uGS,uGM,uGH,uGG;uniform vec2 uGB;uniform vec3 uFringe;uniform vec4 uTint; // tint rgb, mono toning strength
uniform sampler2D uLut3;uniform float uLut3N,uLut3Amt;
vec3 lut3(vec3 c){float N=uLut3N;c=clamp(c,0.0,1.0)*(N-1.0);float b=floor(c.b);float f=c.b-b;vec2 px=1.0/vec2(N*N,N);
  vec2 a=vec2(c.r+0.5+b*N,c.g+0.5)*px,d=vec2(c.r+0.5+min(b+1.0,N-1.0)*N,c.g+0.5)*px;return mix(texture(uLut3,a).rgb,texture(uLut3,d).rgb,f);}
float arr(vec4 a[2],int i){return i<4?a[0][i]:a[1][i-4];}
float lut1(float x,int ch){x=clamp(x,0.0,1.0)*1023.0;int i=int(floor(x));float f=x-float(i);vec4 a=texelFetch(uLut,ivec2(i,0),0),b=texelFetch(uLut,ivec2(min(i+1,1023),0),0);vec4 v=mix(a,b,f);return ch==0?v.r:ch==1?v.g:v.b;}
void main(){
  vec2 tc=TC();vec2 pn=PN();vec4 B=texture(uB,tc);if(B.a==0.0){o=B;return;}
  vec3 lin=B.rgb;vec4 G=texture(uGuide,pn);
  /* 去朦朧（暗通道） */
  if(uFx.z!=0.0){float dk=s2l1(G.b);float Am=max(max(uAtm.r,max(uAtm.g,uAtm.b)),0.05);
    if(uFx.z>0.0){float t=1.0-0.95*uFx.z*clamp(dk/Am,0.0,1.0);lin=(lin-uAtm)/max(t,0.12)+uAtm;lin=max(lin,vec3(0.0));}
    else{lin=mix(lin,uAtm,-uFx.z*0.55*(0.6+0.4*clamp(dk/Am,0.0,1.0)));}}
  float Y=max(dot(lin,LUMA),1.0e-6);float L=l2s1(Y);float Lb=G.g,Lc=G.r;float Lm=mix(L,Lb,0.72);
  float Lpre=l2s1(dot(B.rgb,LUMA));
  float hl=uTone.y,sh=uTone.z;
  /* 亮部／陰影（v1.12，與 Lightroom 相同的局部方式）：在「邊緣保留的底層亮度」上計算調整量，再以線性增益乘回像素，
     局部對比與色彩比例都保留 → 陰影拉亮不發灰發虛、亮部壓暗不偏色；邊緣處改用像素本身亮度，避免光暈 */
  if(hl!=0.0||sh!=0.0){
    float dB=L-Lb;float bb=clamp(Lb+dB*(1.0-exp(-dB*dB/0.02)),0.0,1.2);float b2=bb;
    b2+=hl*0.27*smoothstep(0.48,1.0,bb)*(hl<0.0?bb*0.9:(1.05-bb));
    b2+=sh*0.23*(1.0-smoothstep(0.03,0.52,bb))*(sh>0.0?(1.0-bb)*0.85+0.04:bb);
    float g=s2l1(max(b2,0.0))/max(s2l1(bb),1.0e-5);g=clamp(g,0.03,24.0);
    L=l2s1(Y*g);
  }
  L+=uTone.w*0.22*smoothstep(0.35,1.0,L);
  L+=uBlacks*0.18*(1.0-smoothstep(0.0,0.45,L));
  float Lk=clamp(L,0.0,1.0);L+=uTone.x*0.45*(L-0.46)*4.0*Lk*(1.0-Lk);
  float midw=1.0-pow(abs(2.0*clamp(L,0.0,1.0)-1.0),2.0);
  L+=uFx.x*(uFx.x>0.0?0.6:0.55)*(Lpre-Lc)*midw;
  if(uHasT==1){vec2 tb=texture(uT,tc).rg;L+=uFx.y*(uFx.y>0.0?1.1:0.85)*(Lpre-tb.r);}
  /* 曝光加亮時，高光柔和收邊（Lightroom 的曝光在色調曲線之前，亮部不會一下子衝白） */
  if(uRoll>0.0&&L>0.8){float r0=0.8+0.2*(1.0-exp(-(L-0.8)/0.2));L=mix(L,r0,uRoll);}
  float Yn=s2l1(max(L,0.0));vec3 l2=lin*(Yn/Y);
  /* 超出白點：保持亮度與色相、只降低彩度（不會因單一色版先裁切而偏色） */
  float mx=max(l2.r,max(l2.g,l2.b));if(mx>1.0){if(Yn<0.999){float tq=(1.0-Yn)/(mx-Yn);l2=Yn+(l2-Yn)*tq;}else l2=vec3(1.0);}
  vec3 p=l2s(l2);
  if(uLut3Amt>0.0)p=mix(p,lut3(p),uLut3Amt);
  /* 色調曲線 */
  p=vec3(lut1(p.r,0),lut1(p.g,1),lut1(p.b,2));
  /* 混色器 HSL */
  vec3 hsv=rgb2hsv(clamp(p,0.0,1.0));float h=hsv.x*360.0;
  float cs[9]=float[9](0.0,30.0,60.0,120.0,180.0,240.0,270.0,300.0,360.0);
  int i0=7;for(int i=0;i<8;i++){if(h>=cs[i]&&h<cs[i+1]){i0=i;break;}}
  float t=(h-cs[i0])/(cs[i0+1]-cs[i0]);t=t*t*(3.0-2.0*t);int i1=(i0+1)%8;
  float sat=hsv.y;
  if(uMono==1){
    float g=dot(p,LUMA);float m=mix(arr(uBW,i0),arr(uBW,i1),t);
    g*=exp2(m*1.1*smoothstep(0.0,0.6,sat));p=vec3(g);
  }else{
    float dh=mix(arr(uHH,i0),arr(uHH,i1),t),ds=mix(arr(uHS,i0),arr(uHS,i1),t),dl=mix(arr(uHL,i0),arr(uHL,i1),t);
    if(dh!=0.0||ds!=0.0){hsv.x=fract(hsv.x+dh*30.0/360.0+1.0);hsv.y=clamp(hsv.y*(1.0+ds),0.0,1.0);p=hsv2rgb(hsv);}
    if(dl!=0.0){vec3 ll=s2l(p);ll*=exp2(dl*1.2*smoothstep(0.0,0.5,sat));p=l2s(ll);}
  }
  /* 顏色分級 */
  float Lg=dot(p,LUMA);float piv=0.5-uGB.y*0.3;float wd=0.12+uGB.x*0.38;
  float wsh=1.0-smoothstep(piv-wd,piv+wd*0.6,Lg),whi=smoothstep(piv-wd*0.6,piv+wd,Lg),wmi=exp(-pow((Lg-piv)/(wd*1.3+0.05),2.0));
  p+=uGS.rgb*wsh+uGM.rgb*wmi+uGH.rgb*whi+uGG.rgb;p+=(uGS.a*wsh+uGM.a*wmi+uGH.a*whi+uGG.a)*0.3;
  /* 單色調色 */
  if(uTint.a>0.0){float g=dot(p,LUMA);p=mix(p,g+uTint.rgb*(1.0-abs(2.0*g-1.0)),uTint.a);}
  /* 自然飽和度/飽和度 */
  if(uMono==0){float g=dot(p,LUMA);float mx2=max(p.r,max(p.g,p.b)),mn2=min(p.r,min(p.g,p.b));float s=clamp(mx2-mn2,0.0,1.0);
    float hu=rgb2hsv(clamp(p,0.0,1.0)).x;float skin=1.0-smoothstep(0.03,0.09,abs(hu-0.07));
    float v=uVib*(1.0-s)*(uVib>0.0?(1.0-0.55*skin):1.0);p=g+(p-g)*max(0.0,1.0+uSat+v);}
  /* 褪色 */
  if(uFx.w!=0.0)p=p*(1.0-uFx.w*0.12)+uFx.w*0.08;
  /* 移除色差（紫邊/綠邊） */
  if(uFringe.z>0.0&&uHasT==1){vec2 tb=texture(uT,tc).rg;float e=clamp(abs(Lpre-tb.g)*14.0+length(vec2(dFdx(tb.g),dFdy(tb.g)))*24.0,0.0,1.0);
    vec3 hv=rgb2hsv(clamp(p,0.0,1.0));float pu=1.0-smoothstep(0.05,0.11,abs(hv.x-0.79));float gr=1.0-smoothstep(0.05,0.11,abs(hv.x-0.36));
    float k=clamp(e*(pu*uFringe.x+gr*uFringe.y)*1.5,0.0,1.0);p=mix(p,vec3(dot(p,LUMA)),k);}
  o=vec4(p,B.a);
}`;

  /* 遮色片：區域調整 */
  const FS_MASK = HEAD + `
uniform sampler2D uC,uB,uT,uGuide,uBrush,uSky;uniform vec4 uBrushRect;uniform int uHasT;
uniform int uMType,uInv;uniform float uMAmt;uniform vec4 uMP1,uMP2;uniform vec2 uSAsp;uniform vec3 uAtm;
uniform vec4 uMA1,uMA2,uMA3;uniform int uViz;
float maskW(vec2 pn,vec3 pc){
  vec2 s=outToSrc(pn);vec2 q=s*uSAsp;float w=0.0;
  if(uMType==1){vec2 a=uMP1.xy*uSAsp,b=uMP1.zw*uSAsp;float t=dot(q-a,b-a)/max(dot(b-a,b-a),1e-8);w=1.0-smoothstep(0.0,1.0,clamp(t,0.0,1.0));}
  else if(uMType==2){vec2 d=q-uMP1.xy*uSAsp;float ca=cos(uMP2.x),sa=sin(uMP2.x);d=vec2(ca*d.x+sa*d.y,-sa*d.x+ca*d.y);float r=length(d/max(uMP1.zw,vec2(1e-4)));float f=clamp(uMP2.y,0.01,1.0);w=1.0-smoothstep(1.0-f,1.0,r);}
  else if(uMType==3){vec2 tc=(s-uBrushRect.xy)/uBrushRect.zw;w=(tc.x<0.0||tc.y<0.0||tc.x>1.0||tc.y>1.0)?0.0:texture(uBrush,tc).a;}
  else if(uMType==4){w=texture(uSky,clamp(s,0.0,1.0)).r;float L=dot(pc,LUMA);w*=smoothstep(uMP1.x-0.1,uMP1.x+0.02,L);}
  else if(uMType==5){float L=dot(pc,LUMA);float sm=max(uMP1.z,0.002);w=smoothstep(uMP1.x-sm,uMP1.x,L)*(1.0-smoothstep(uMP1.y,uMP1.y+sm,L));}
  else if(uMType==6){vec3 a=rgb2hsv(clamp(pc,0.0,1.0)),b=rgb2hsv(clamp(uMP1.rgb,0.0,1.0));float dh=abs(a.x-b.x);dh=min(dh,1.0-dh);
    float d=dh*2.6*min(a.y,b.y)*2.0+abs(a.y-b.y)*0.7+abs(a.z-b.z)*0.45;w=1.0-smoothstep(uMP1.a,uMP1.a+0.12,d);}
  else if(uMType==7){w=1.0;}
  if(uInv==1)w=1.0-w;return clamp(w,0.0,1.0)*uMAmt;
}
void main(){
  vec2 tc=TC();vec2 pn=PN();vec4 C=texture(uC,tc);if(C.a==0.0){o=uViz==1?vec4(0.0):C;return;}
  float w=maskW(pn,C.rgb);
  if(uViz==1){o=vec4(w,w,w,1.0);return;}
  if(w<0.001){o=C;return;}
  vec3 lin=s2l(C.rgb);vec4 G=texture(uGuide,pn);
  if(uMA3.x!=0.0){float dk=s2l1(G.b);float Am=max(max(uAtm.r,max(uAtm.g,uAtm.b)),0.05);float k=uMA3.x*w;
    if(k>0.0){float t=1.0-0.95*k*clamp(dk/Am,0.0,1.0);lin=max((lin-uAtm)/max(t,0.12)+uAtm,vec3(0.0));}else lin=mix(lin,uAtm,-k*0.55);}
  lin*=exp2(uMA1.x*w);lin*=wbGain(uMA2.x*w,uMA2.y*w);
  float Y=max(dot(lin,LUMA),1e-6);float L=l2s1(Y);float Lb=G.g,Lc=G.r;float Lm=mix(L,Lb,0.7);
  float hl=uMA1.z*w,sh=uMA1.w*w;
  L+=hl*0.32*smoothstep(0.45,0.97,Lm)*(hl<0.0?L:(1.05-L));
  L+=sh*0.40*(1.0-smoothstep(0.03,0.55,Lm))*(sh>0.0?(1.0-L)*0.9+0.05:L);
  L+=uMA3.w*w*0.22*smoothstep(0.35,1.0,L);
  float Lk=clamp(L,0.0,1.0);L+=uMA1.y*w*0.45*(L-0.46)*4.0*Lk*(1.0-Lk);
  float Lpre=l2s1(dot(texture(uB,tc).rgb,LUMA));float midw=1.0-pow(abs(2.0*clamp(L,0.0,1.0)-1.0),2.0);
  L+=uMA2.w*w*0.6*(Lpre-Lc)*midw;
  if(uHasT==1){vec2 tb=texture(uT,tc).rg;L+=uMA3.y*w*1.6*(Lpre-tb.g);L+=uMA3.z*w*1.0*(Lpre-tb.r);}
  float Yn=s2l1(max(L,0.0));lin*=Yn/Y;vec3 p=l2s(lin);
  float g=dot(p,LUMA);p=g+(p-g)*max(0.0,1.0+uMA2.z*w);
  o=vec4(p,C.a);
}`;

  /* 收尾：銳化、暈影、顆粒 */
  const FS_FINISH = HEAD + `
uniform sampler2D uC,uB,uT;uniform int uHasT;uniform vec4 uSharp;uniform vec4 uVig;uniform float uVigHl;uniform vec3 uGrain;uniform int uAlphaOut;
uint hh(uvec2 v){v=v*1664525u+1013904223u;v.x+=v.y*1664525u;v.y+=v.x*1664525u;v^=v>>16u;v.x+=v.y*1664525u;v.y+=v.x*1664525u;v^=v>>16u;return v.x;}
float rnd(vec2 i){return float(hh(uvec2(ivec2(i)+ivec2(65536))))/4294967295.0;}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(rnd(i),rnd(i+vec2(1,0)),u.x),mix(rnd(i+vec2(0,1)),rnd(i+vec2(1,1)),u.x),u.y);}
void main(){
  vec2 tc=TC();vec2 pn=PN();vec4 C=texture(uC,tc);
  if(C.a==0.0){o=uAlphaOut==1?vec4(0.0):vec4(1.0);return;}
  vec3 p=C.rgb;
  if(uSharp.x>0.0&&uHasT==1){
    float Lpre=l2s1(dot(texture(uB,tc).rgb,LUMA));vec2 px=1.0/uWork;float bl=texture(uT,tc).g;
    float hp=Lpre-bl;float lim=mix(0.03,0.25,uSharp.y);hp=clamp(hp,-lim,lim);
    float gx=texture(uT,tc+vec2(px.x,0.0)).g-texture(uT,tc-vec2(px.x,0.0)).g,gy=texture(uT,tc+vec2(0.0,px.y)).g-texture(uT,tc-vec2(0.0,px.y)).g;
    float gr=length(vec2(gx,gy))/max(uSigma,0.25);float em=uSharp.z>0.0?smoothstep(uSharp.z*0.05,uSharp.z*0.05+0.03,gr):1.0;
    p+=hp*uSharp.x*2.2*em*(1.0+uSharp.y);
  }
  if(uVig.x!=0.0){
    float ar=uOutSize.x/uOutSize.y;vec2 d=(pn-0.5)*2.0;float rd=uVig.z;
    if(rd>0.0){if(ar>=1.0)d.x*=mix(1.0,ar,rd);else d.y*=mix(1.0,1.0/ar,rd);}
    float k=mix(2.0,7.0,clamp(-rd,0.0,1.0));float e=pow(pow(abs(d.x),k)+pow(abs(d.y),k),1.0/k);
    float r0=mix(0.15,1.25,uVig.y);float r1=r0+mix(0.06,1.1,uVig.w);float f=smoothstep(r0,r1,e);
    vec3 l=s2l(p);
    if(uVig.x<0.0){float L=dot(p,LUMA);f*=1.0-uVigHl*smoothstep(0.55,1.0,L);l*=1.0+uVig.x*f;}else l=mix(l,vec3(1.0),uVig.x*f*0.85);
    p=l2s(l);
  }
  if(uGrain.x>0.0){
    vec2 gp=(uOutOrigin+gl_FragCoord.xy)/uSigma;float sz=mix(0.7,4.5,uGrain.y);
    float n=vn(gp/sz);float n2=vn(gp/(sz*0.45)+17.3);n=mix(n,n2,uGrain.z*0.7);
    float L=dot(p,LUMA);float amp=uGrain.x*0.16*(1.0-0.55*pow(abs(2.0*L-1.0),2.0))*clamp(sqrt(uSigma*sz),0.35,1.0);
    p+=(n-0.5)*amp;
  }
  o=vec4(clamp(p,0.0,1.0),uAlphaOut==1?C.a:1.0);
}`;

  /* 螢幕顯示：平移縮放、前後對比、遮色片疊加 */
  const FS_DISPLAY = `#version 300 es
precision highp float;out vec4 o;
uniform sampler2D uImg,uBefore,uDetail,uOv;uniform vec2 uCv;uniform vec3 uView;uniform vec2 uImgSize;uniform vec4 uDetRect;uniform int uHasDet,uHasBefore,uHasOv;uniform float uSplit;uniform vec3 uBg;uniform vec4 uOvCol;uniform int uChecker;
void main(){
  vec2 sp=vec2(gl_FragCoord.x,uCv.y-gl_FragCoord.y);vec2 ip=(sp-uView.yz)/uView.x;
  if(ip.x<0.0||ip.y<0.0||ip.x>uImgSize.x||ip.y>uImgSize.y){o=vec4(uBg,1.0);return;}
  vec2 tc=ip/uImgSize;vec4 c;
  if(uHasBefore==1&&sp.x<uSplit)c=texture(uBefore,tc);
  else if(uHasDet==1&&ip.x>=uDetRect.x&&ip.y>=uDetRect.y&&ip.x<uDetRect.x+uDetRect.z&&ip.y<uDetRect.y+uDetRect.w)c=texture(uDetail,(ip-uDetRect.xy)/uDetRect.zw);
  else c=texture(uImg,tc);
  if(c.a<1.0){vec2 ck=floor(sp/10.0);float k=mod(ck.x+ck.y,2.0)*0.08+0.86;c.rgb=mix(uChecker==1?vec3(k):uBg,c.rgb,c.a);}
  if(uHasOv==1){float w=texture(uOv,tc).r;c.rgb=mix(c.rgb,uOvCol.rgb,w*uOvCol.a);}
  o=vec4(c.rgb,1.0);
}`;

  /* 輔助：縮小 RGBA8 以供讀回（直方圖等） */
  const FS_COPY = `#version 300 es
precision highp float;out vec4 o;uniform sampler2D uIn;uniform vec2 uWork;void main(){o=texture(uIn,gl_FragCoord.xy/uWork);}`;
  const FS_GUIDEREAD = HEAD + `
uniform sampler2D uIn;void main(){vec4 c=texture(uIn,TC());vec3 p=l2s(c.rgb);o=vec4(clamp(p,0.0,1.0),min(p.r,min(p.g,p.b)));}`;

  /* ---------- GL 基礎 ---------- */
  function compile(fs, name) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(name, log); throw new Error('著色器編譯失敗 ' + name + ': ' + log); }
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('著色器連結失敗 ' + name + ': ' + gl.getProgramInfoLog(p));
    const U = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const base = info.name.replace(/\[0\]$/, ''); U[base] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size }; }
    return { p, U, name };
  }
  let cur = null, unit = 0;
  function use(prog) { cur = prog; unit = 0; gl.useProgram(prog.p); }
  function set(name, v) {
    const u = cur.U[name]; if (!u) return;
    switch (u.type) {
      case gl.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, v | 0); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
      case gl.SAMPLER_2D: gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v ? v.t : dummy.t); gl.uniform1i(u.loc, unit); unit++; break;
    }
  }
  function draw(target, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? fb(target) : null);
    gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function mkTex(w, h, kind, data) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    if (kind === 'f16') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else if (kind === 'f32') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data || null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data || null);
    const filt = kind === 'f32' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { t, w, h, kind, fb: null };
  }
  function fb(tex) {
    if (!tex.fb) { tex.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.t, 0); }
    return tex.fb;
  }
  function freeTex(tex) { if (!tex) return; if (tex.fb) gl.deleteFramebuffer(tex.fb); gl.deleteTexture(tex.t); }
  function work(name, w, h, kind) {
    kind = kind || (HF ? 'f16' : 'u8');
    const e = pool[name];
    if (e && e.w === w && e.h === h && e.kind === kind) return e;
    freeTex(e); return (pool[name] = mkTex(w, h, kind));
  }
  function uploadImage(tex, img, w, h) {
    if (!tex || tex.w !== w || tex.h !== h) { freeTex(tex); tex = mkTex(w, h, 'u8'); }
    gl.bindTexture(gl.TEXTURE_2D, tex.t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (img instanceof Uint8Array || img instanceof Uint8ClampedArray) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, img instanceof Uint8ClampedArray ? new Uint8Array(img.buffer, img.byteOffset, img.length) : img);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    return tex;
  }
  let dummy = null;

  function init(cv) {
    canvas = cv;
    gl = cv.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('此裝置不支援 WebGL2');
    maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const e1 = gl.getExtension('EXT_color_buffer_float'), e2 = e1 ? null : gl.getExtension('EXT_color_buffer_half_float');
    HF = !!(e1 || e2);
    if (HF) { const t = mkTex(4, 4, 'f16'); gl.bindFramebuffer(gl.FRAMEBUFFER, fb(t)); HF = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; freeTex(t); }
    dummy = mkTex(1, 1, 'u8', new Uint8Array([0, 0, 0, 0]));
    P.develop = compile(FS_DEVELOP, 'develop'); P.nr = compile(FS_NR, 'nr'); P.sep = compile(FS_SEP, 'sep');
    P.main = compile(FS_MAIN, 'main'); P.mask = compile(FS_MASK, 'mask'); P.finish = compile(FS_FINISH, 'finish');
    P.display = compile(FS_DISPLAY, 'display'); P.copy = compile(FS_COPY, 'copy'); P.gread = compile(FS_GUIDEREAD, 'gread');
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (Engine.onLost) Engine.onLost(); });
    return { maxTex, HF };
  }

  /* ---------- 幾何（JS 端，與著色器一致） ---------- */
  function mat3mul(a, b) { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j]; r[i * 3 + j] = s; } return r; }
  function mat3inv(m) {
    const [a, b, c, d, e, f, g, h, i] = m; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g), G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
    return [A / det, D / det, G / det, B / det, E / det, H / det, C / det, F / det, I / det];
  }
  /* 建立幾何描述；SW,SH 為原圖（已轉正）尺寸 */
  function geometry(e, SW, SH, cropOverride) {
    const g = e.geo, c = cropOverride || e.crop;
    const rot = ((c.rot90 % 4) + 4) % 4;
    const BW = rot % 2 ? SH : SW, BH = rot % 2 ? SW : SH; const BD = Math.max(BW, BH) / 2;
    const th = ((g.rot || 0) + (c.angle || 0)) * Math.PI / 180;
    const kv = (g.vert || 0) / 100 * 0.55, kh = (g.horiz || 0) / 100 * 0.55;
    const sc = (g.scale || 100) / 100, asp = Math.pow(2, (g.aspect || 0) / 100 * 0.5);
    const Pm = [1, 0, 0, 0, 1, 0, kh, kv, 1];
    const R = [Math.cos(th), -Math.sin(th), 0, Math.sin(th), Math.cos(th), 0, 0, 0, 1];
    const A = [asp, 0, 0, 0, 1 / asp, 0, 0, 0, 1], S = [sc, 0, 0, 0, sc, 0, 0, 0, 1];
    const Tr = [1, 0, (g.ox || 0) / 100 * 0.5, 0, 1, (g.oy || 0) / 100 * 0.5, 0, 0, 1];
    const F = mat3mul(Tr, mat3mul(S, mat3mul(A, mat3mul(R, Pm))));
    const Inv = mat3inv(F);
    const distK = -((g.dist || 0) + (e.optics.dist || 0)) / 100 * 0.3;
    const SD = Math.hypot(SW, SH) / 2;
    // 鏡頭描述檔
    let lens = null; const pr = e.optics.prof;
    if (pr && pr.on && pr.p) {
      const P = pr.p, camCrop = pr.camCrop || P.crop || 1, lc = P.crop || camCrop, asp = P.aspect || 1.5;
      const pxmm = Math.hypot(SW, SH) / (43.2666 / camCrop), dmm = 43.2666 / lc;
      lens = { m: 0, k: [0, 0, 0], u: dmm / Math.sqrt(1 + asp * asp) / 2 * pxmm, amt: (pr.d == null ? 100 : pr.d) / 100, vu: dmm / 2 * pxmm, vig: P.vig, vamt: (pr.v == null ? 100 : pr.v) / 100, tca: pr.tca !== false ? P.tca : null };
      const d = P.dist; if (d && !P.fisheye) { if (d[1] === 'p') { lens.m = 1; lens.k = [d[2], d[3], d[4]]; } else if (d[1] === '3') { lens.m = 2; lens.k = [d[2], 0, 0]; } else if (d[1] === '5') { lens.m = 3; lens.k = [d[2], d[3], 0]; } }
    }
    const G0 = { SW, SH, SD, distK, lens, lz: 1 };
    // 鏡頭校正／變形校正後邊緣會出現空白（白邊）：與 Lightroom 相同，自動放大到剛好填滿畫面
    if ((lens && lens.m) || distK) { let worst = 1; for (let i = 0; i <= 24; i++) { const t = i / 24; for (const q of [[t, 0], [t, 1], [0, t], [1, t]]) { const m = sensorMap(G0, q); worst = Math.max(worst, Math.abs(m[0] - .5) / .5, Math.abs(m[1] - .5) / .5); } }
      if (worst > 1.0005) { let lo = 1 / worst * 0.9, hi = 1; for (let k = 0; k < 18; k++) { const z = (lo + hi) / 2; G0.lz = z; let ok = true; for (let i = 0; i <= 24 && ok; i++) { const t = i / 24; for (const q of [[t, 0], [t, 1], [0, t], [1, t]]) { const m = sensorMap(G0, q); if (m[0] < -1e-4 || m[0] > 1.0001 || m[1] < -1e-4 || m[1] > 1.0001) { ok = false; break; } } } if (ok) lo = z; else hi = z; } G0.lz = lo; } }
    return { SW, SH, BW, BH, BD, F, Inv, rot, flipH: !!c.flipH, flipV: !!c.flipV, crop: [c.x, c.y, c.w, c.h], distK, SD, lens, lz: G0.lz,
      invT: [Inv[0], Inv[3], Inv[6], Inv[1], Inv[4], Inv[7], Inv[2], Inv[5], Inv[8]],
      OW: Math.max(1, Math.round(c.w * BW)), OH: Math.max(1, Math.round(c.h * BH)) };
  }
  function outToSrc(G, pn) {
    const t = [G.crop[0] + pn[0] * G.crop[2], G.crop[1] + pn[1] * G.crop[3]];
    let cx = (t[0] - .5) * G.BW / G.BD, cy = (t[1] - .5) * G.BH / G.BD;
    const I = G.Inv; const hx = I[0] * cx + I[1] * cy + I[2], hy = I[3] * cx + I[4] * cy + I[5], hz = I[6] * cx + I[7] * cy + I[8];
    cx = hx / hz; cy = hy / hz;
    let bx = cx * G.BD / G.BW + .5, by = cy * G.BD / G.BH + .5;
    if (G.flipH) bx = 1 - bx; if (G.flipV) by = 1 - by;
    let s = [bx, by]; if (G.rot === 1) s = [by, 1 - bx]; else if (G.rot === 2) s = [1 - bx, 1 - by]; else if (G.rot === 3) s = [1 - by, bx];
    return sensorMap(G, s);
  }
  function lensF(G, r) { const L = G.lens, k = L.k; const f = L.m === 1 ? k[0] * r * r * r + k[1] * r * r + k[2] * r + 1 - k[0] - k[1] - k[2] : L.m === 2 ? 1 - k[0] + k[0] * r * r : 1 + k[0] * r * r + k[1] * r * r * r * r; return 1 + (f - 1) * L.amt; }
  function sensorMap(G, s) {
    if (G.lz && G.lz !== 1) s = [.5 + (s[0] - .5) * G.lz, .5 + (s[1] - .5) * G.lz];
    if (G.lens && G.lens.m) { const px = (s[0] - .5) * G.SW, py = (s[1] - .5) * G.SH; const f = lensF(G, Math.hypot(px, py) / G.lens.u); s = [.5 + px * f / G.SW, .5 + py * f / G.SH]; }
    const dx = (s[0] - .5) * G.SW / G.SD, dy = (s[1] - .5) * G.SH / G.SD, f = 1 + G.distK * (dx * dx + dy * dy);
    return [.5 + (s[0] - .5) * f, .5 + (s[1] - .5) * f];
  }
  function srcToOut(G, s) {
    // 反解鏡頭變形（迭代）
    let u = [s[0], s[1]];
    for (let i = 0; i < 12; i++) { const m = sensorMap(G, u); u = [u[0] + (s[0] - m[0]), u[1] + (s[1] - m[1])]; }
    let b; if (G.rot === 1) b = [1 - u[1], u[0]]; else if (G.rot === 2) b = [1 - u[0], 1 - u[1]]; else if (G.rot === 3) b = [u[1], 1 - u[0]]; else b = u;
    if (G.flipH) b[0] = 1 - b[0]; if (G.flipV) b[1] = 1 - b[1];
    let cx = (b[0] - .5) * G.BW / G.BD, cy = (b[1] - .5) * G.BH / G.BD; const F = G.F;
    const hx = F[0] * cx + F[1] * cy + F[2], hy = F[3] * cx + F[4] * cy + F[5], hz = F[6] * cx + F[7] * cy + F[8];
    cx = hx / hz; cy = hy / hz;
    const t = [cx * G.BD / G.BW + .5, cy * G.BD / G.BH + .5];
    return [(t[0] - G.crop[0]) / G.crop[2], (t[1] - G.crop[1]) / G.crop[3]];
  }
  function lensColorUniforms(G) {
    const L = G.lens; const t = L && L.tca;
    if (t) { const tr = t[1] === 'l' ? [t[2], t[3], 0, 0] : [t[2], t[3], t[4], t[5]]; set('uTcaOn', 1); set('uTca', tr); set('uTca2', t[1] === 'l' ? [0, 0] : [t[6], t[7]]); } else set('uTcaOn', 0);
    if (L && L.vig) { set('uLV', L.vig); set('uLVU', L.vu); set('uLVAmt', L.vamt); } else set('uLVAmt', 0);
  }
  function setGeoUniforms(G) {
    set('uCrop', G.crop); set('uBSize', [G.BW, G.BH]); set('uBD', G.BD); set('uInvT', G.invT);
    set('uRot90', G.rot); set('uFlip', [G.flipH ? 1 : 0, G.flipV ? 1 : 0]); set('uSSize', [G.SW, G.SH]); set('uSD', G.SD); set('uDistK', G.distK);
    const L = G.lens; set('uLM', L ? L.m : 0); set('uLK', L ? L.k : [0, 0, 0]); set('uLU', L ? L.u : 1); set('uLAmt', L ? L.amt : 0); set('uLZ', G.lz || 1);
  }

  /* ---------- 參數 → uniform ---------- */
  function wbGainJS(t, m) { const g = [Math.exp(0.36 * t), Math.exp(-0.24 * m), Math.exp(-0.36 * t)]; const k = g[0] * LUMA[0] + g[1] * LUMA[1] + g[2] * LUMA[2]; return g.map((v) => v / k); }
  function hueVec(hdeg, s) {
    const h = ((hdeg % 360) + 360) % 360 / 60; const x = 1 - Math.abs(h % 2 - 1);
    let c = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
    const y = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]; return c.map((v) => (v - y) * s);
  }
  function monotone(pts) {
    // 單調三次樣條（Fritsch–Carlson）
    const p = pts.slice().sort((a, b) => a[0] - b[0]); const n = p.length;
    if (n < 2) return (x) => x;
    const dx = [], dy = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx.push(p[i + 1][0] - p[i][0] || 1e-6); dy.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0] || 1e-6)); }
    m.push(dy[0]); for (let i = 1; i < n - 1; i++) m.push(dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2); m.push(dy[n - 2]);
    for (let i = 0; i < n - 1; i++) { if (dy[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / dy[i], b = m[i + 1] / dy[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * dy[i]; m[i + 1] = t * b * dy[i]; } }
    return (x) => {
      if (x <= p[0][0]) return p[0][1]; if (x >= p[n - 1][0]) return p[n - 1][1];
      let i = 0; while (i < n - 2 && x > p[i + 1][0]) i++;
      const h = dx[i], t = (x - p[i][0]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
    };
  }
  function parametric(par) {
    const { h = 0, l = 0, d = 0, s = 0, s1 = 25, s2 = 50, s3 = 75 } = par || {};
    if (!h && !l && !d && !s) return null;
    const a = s1 / 100, b = s2 / 100, c = s3 / 100;
    const bump = (x, lo, hi) => { if (x <= lo || x >= hi) return 0; const t = (x - lo) / (hi - lo); return Math.sin(Math.PI * t); };
    return (x) => x + (s / 100) * 0.18 * bump(x, 0, b) + (d / 100) * 0.16 * bump(x, a * 0.3, c) + (l / 100) * 0.16 * bump(x, a, 1 - (1 - c) * 0.3) + (h / 100) * 0.18 * bump(x, b, 1);
  }
  let lutTex = null, lutKey = '';
  function buildLut(curve) {
    const key = JSON.stringify(curve); if (key === lutKey && lutTex) return lutTex; lutKey = key;
    const id = (pts) => !pts || (pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1);
    const fm = id(curve.rgb) ? (x) => x : monotone(curve.rgb), fp = parametric(curve.par);
    const fr = id(curve.r) ? null : monotone(curve.r), fg = id(curve.g) ? null : monotone(curve.g), fb2 = id(curve.b) ? null : monotone(curve.b);
    const d = new Float32Array(1024 * 4);
    for (let i = 0; i < 1024; i++) {
      let x = i / 1023; if (fp) x = Math.min(1, Math.max(0, fp(x))); x = Math.min(1, Math.max(0, fm(x)));
      d[i * 4] = fr ? fr(x) : x; d[i * 4 + 1] = fg ? fg(x) : x; d[i * 4 + 2] = fb2 ? fb2(x) : x; d[i * 4 + 3] = 1;
    }
    if (!lutTex) lutTex = mkTex(1024, 1, 'f32', d); else { gl.bindTexture(gl.TEXTURE_2D, lutTex.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, 1, 0, gl.RGBA, gl.FLOAT, d); }
    return lutTex;
  }

  function skyUniforms(e) {
    const k = e._skyRep; if (!k) { set('uSkyOn', 0); return; }
    set('uSkyOn', 1); set('uSkyM', k.mask); set('uSkyR', k.rep); set('uSkyBox', k.box); set('uSkyP', [k.lmin, k.gaps, k.edge, k.amt]);
    set('uSkyQ', [k.gain, k.haze, k.flip ? 1 : 0, k.relight]); set('uSkyT', k.tgain); set('uSkyAvg', k.avg);
  }
  /* ---------- 渲染一個工作區塊 ---------- */
  /* job: {e:有效參數, G:幾何, W,H:工作尺寸, origin:[x,y] 輸出像素座標, sigma, src:{tex,dn,rect}, brush:{maskId:{tex,rect}}, target:RGBA8 tex,
           guide, sky, atm, alphaOut, maskViz:index } */
  function runPasses(job) {
    const { e, G, W, H, sigma } = job; const k = job.pool || 'p';
    const A = work(k + 'A', W, H), B = work(k + 'B', W, H), T1 = work(k + 'T1', W, H), T = work(k + 'T', W, H), C1 = work(k + 'C1', W, H), C2 = work(k + 'C2', W, H);
    const common = () => { set('uOutOrigin', job.origin); set('uOutSize', [G.OW * sigma, G.OH * sigma]); set('uWork', [W, H]); set('uSigma', sigma); setGeoUniforms(G); };
    // P1
    use(P.develop); common();
    set('uSrc', job.src.tex); set('uSrcDn', job.src.dn || job.src.tex); set('uAi', e.ai.on && job.src.dn ? e.ai.amt / 100 : 0);
    set('uSrcRect', job.src.rect);
    const wb = wbGainJS(e.temp / 100, e.tint / 100), ex = Math.pow(2, e.exposure);
    set('uGain', wb.map((v) => v * ex)); set('uVigCorr', (e.optics.vigCorr || 0) / 100 * 0.9); lensColorUniforms(G); skyUniforms(e); set('uBicubic', sigma >= 0.9 ? 1 : 0);
    draw(A, W, H);
    // P2 雜色
    let cur = A;
    const nr = e.nr;
    if ((nr.lum > 0 || nr.col > 0) && sigma * (1.5 + Math.max(nr.lum, nr.col) / 100 * 6) >= 0.75) {
      use(P.nr); common(); set('uA', A); set('uNR', [nr.lum / 100, nr.ldet / 100, nr.lcon / 100, 0]); set('uCNR', [nr.col / 100, nr.cdet / 100, nr.csm / 100]);
      draw(B, W, H); cur = B;
    }
    // P3 細節模糊（紋理、銳化、色差、遮色片）
    const needT = e.texture !== 0 || e.sharp.amt > 0 || e.optics.ca || e.masks.some((m) => m.on !== false && (m.adj.sharp || m.adj.texture));
    if (needT) {
      const st = Math.max(0.6, 3.0 * sigma), ss = Math.max(0.5, (e.sharp.rad || 1) * sigma);
      use(P.sep); common(); set('uIn', cur); set('uDir', [1, 0]); set('uSig', [st, ss, 0]); set('uMinB', 0); set('uFromLin', 1); draw(T1, W, H);
      use(P.sep); common(); set('uIn', T1); set('uDir', [0, 1]); set('uSig', [st, ss, 0]); set('uMinB', 0); set('uFromLin', 0); draw(T, W, H);
    }
    // P4
    use(P.main); common();
    set('uB', cur); set('uT', T); set('uHasT', needT ? 1 : 0); set('uGuide', job.guide); set('uLut', buildLut(e.curve));
    set('uTone', [e.contrast / 100, e.highlights / 100, e.shadows / 100, e.whites / 100]); set('uBlacks', e.blacks / 100); set('uRoll', Math.min(1, Math.max(0, e.exposure || 0) / 0.6));
    set('uFx', [e.clarity / 100, e.texture / 100, e.dehaze / 100, (e.fade || 0) / 100]); set('uAtm', job.atm);
    set('uVib', e.vibrance / 100); set('uSat', e.saturation / 100);
    const h8 = (a) => a.map((v) => v / 100);
    set('uHH', h8(e.hsl.hue)); set('uHS', h8(e.hsl.sat)); set('uHL', h8(e.hsl.lum)); set('uBW', h8(e.bw)); set('uMono', e.mono ? 1 : 0);
    const gv = (z) => { const v = hueVec(z.h, z.s / 100 * 0.22); return [v[0], v[1], v[2], z.l / 100]; };
    set('uGS', gv(e.grade.sh)); set('uGM', gv(e.grade.mid)); set('uGH', gv(e.grade.hi)); set('uGG', gv(e.grade.glob));
    set('uGB', [e.grade.blend / 100, e.grade.balance / 100]);
    set('uFringe', [e.optics.purple / 100, e.optics.green / 100, e.optics.ca ? 1 : 0]);
    set('uLut3', job.lut3 ? job.lut3.tex : null); set('uLut3N', job.lut3 ? job.lut3.N : 2); set('uLut3Amt', job.lut3 ? clamp01x(job.lut3.amt) : 0);
    const tn = e.toning || { h: 0, s: 0 }; const tv = hueVec(tn.h, 0.35); set('uTint', [tv[0], tv[1], tv[2], (tn.s || 0) / 100]);
    draw(C1, W, H);
    let c = C1, other = C2;
    // P5 遮色片
    const masks = e.masks.filter((m) => m.on !== false);
    for (let i = 0; i < masks.length; i++) {
      const m = masks[i]; const viz = job.maskViz === m.id;
      use(P.mask); common(); setMaskUniforms(m, job, G);
      set('uC', c); set('uB', cur); set('uT', T); set('uHasT', needT ? 1 : 0); set('uGuide', job.guide); set('uSky', job.sky); set('uAtm', job.atm); set('uViz', 0);
      draw(other, W, H); [c, other] = [other, c];
    }
    // P6
    use(P.finish); common();
    set('uC', c); set('uB', cur); set('uT', T); set('uHasT', needT ? 1 : 0);
    set('uSharp', [e.sharp.amt / 150, e.sharp.det / 100, e.sharp.mask / 100, 0]);
    set('uVig', [e.vig.amt / 100, e.vig.mid / 100, e.vig.round / 100, e.vig.feather / 100]); set('uVigHl', e.vig.hl / 100);
    set('uGrain', [e.grain.amt / 100, e.grain.size / 100, e.grain.rough / 100]); set('uAlphaOut', job.alphaOut ? 1 : 0);
    draw(job.target, W, H);
    // 遮色片視覺化
    if (job.vizTarget && job.maskViz) {
      const m = e.masks.find((x) => x.id === job.maskViz);
      if (m) { use(P.mask); common(); setMaskUniforms(m, job, G); set('uC', C1); set('uB', cur); set('uT', T); set('uHasT', 0); set('uGuide', job.guide); set('uSky', job.sky); set('uAtm', job.atm); set('uViz', 1); draw(job.vizTarget, W, H); }
    }
  }
  function clamp01x(v) { return Math.max(0, Math.min(2, v)); }
  const MT = { linear: 1, radial: 2, brush: 3, sky: 4, lum: 5, color: 6, all: 7 };
  function setMaskUniforms(m, job, G) {
    set('uMType', MT[m.type] || 7); set('uInv', m.invert ? 1 : 0); set('uMAmt', (m.amt == null ? 100 : m.amt) / 100);
    const L = Math.max(G.SW, G.SH); set('uSAsp', [G.SW / L, G.SH / L]);
    const p = m.p || {};
    if (m.type === 'linear') set('uMP1', [p.ax, p.ay, p.bx, p.by]);
    else if (m.type === 'radial') { set('uMP1', [p.cx, p.cy, p.rx, p.ry]); set('uMP2', [p.ang || 0, (p.feather == null ? 50 : p.feather) / 100, 0, 0]); }
    else if (m.type === 'sky') set('uMP1', [job.skyLmin || 0.3, 0, 0, 0]);
    else if (m.type === 'lum') set('uMP1', [p.lo / 100, p.hi / 100, p.sm / 100, 0]);
    else if (m.type === 'color') set('uMP1', [p.r, p.g, p.b, (p.range == null ? 30 : p.range) / 100 * 0.6]);
    if (m.type === 'brush') { const b = job.brush && job.brush[m.id]; set('uBrush', b ? b.tex : null); set('uBrushRect', b ? b.rect : [0, 0, 1, 1]); }
    else set('uBrush', null);
    const a = m.adj;
    set('uMA1', [(a.exposure || 0), (a.contrast || 0) / 100, (a.highlights || 0) / 100, (a.shadows || 0) / 100]);
    set('uMA2', [(a.temp || 0) / 100, (a.tint || 0) / 100, (a.saturation || 0) / 100, (a.clarity || 0) / 100]);
    set('uMA3', [(a.dehaze || 0) / 100, (a.sharp || 0) / 100, (a.texture || 0) / 100, (a.whites || 0) / 100]);
  }

  /* 導引圖（低解析度全圖）：R=大範圍模糊亮度（清晰度）、G=中範圍（亮部/陰影）、B=暗通道（去朦朧） */
  function buildGuide(e, G, src, gLong, pre) {
    pre = pre || 'g';
    const s = gLong / Math.max(G.OW, G.OH); const W = Math.max(8, Math.round(G.OW * s)), H = Math.max(8, Math.round(G.OH * s));
    const A = work(pre + 'A', W, H), T1 = work(pre + 'T1', W, H), T2 = work(pre + 'T2', W, H), GD = work(pre + 'guide', W, H);
    const common = () => { set('uOutOrigin', [0, 0]); set('uOutSize', [W, H]); set('uWork', [W, H]); set('uSigma', s); setGeoUniforms(G); };
    use(P.develop); common(); set('uSrc', src.tex); set('uSrcDn', src.dn || src.tex); set('uAi', e.ai.on && src.dn ? e.ai.amt / 100 : 0); set('uSrcRect', src.rect);
    const wb = wbGainJS(e.temp / 100, e.tint / 100), ex = Math.pow(2, e.exposure); set('uGain', wb.map((v) => v * ex)); set('uVigCorr', (e.optics.vigCorr || 0) / 100 * 0.9); lensColorUniforms(G); skyUniforms(e); set('uBicubic', 0);
    draw(A, W, H);
    const L = Math.max(W, H); const sL = L * 0.022, sM = L * 0.009, rMin = Math.max(2, Math.round(L * 0.008));
    use(P.sep); common(); set('uIn', A); set('uDir', [1, 0]); set('uSig', [sL, sM, rMin]); set('uMinB', 1); set('uFromLin', 1); draw(T1, W, H);
    use(P.sep); common(); set('uIn', T1); set('uDir', [0, 1]); set('uSig', [sL, sM, rMin]); set('uMinB', 1); set('uFromLin', 0); draw(T2, W, H);
    use(P.sep); common(); set('uIn', T2); set('uDir', [1, 0]); set('uSig', [0, 0, rMin * 1.2]); set('uMinB', 0); set('uFromLin', 0); draw(T1, W, H);
    use(P.sep); common(); set('uIn', T1); set('uDir', [0, 1]); set('uSig', [0, 0, rMin * 1.2]); set('uMinB', 0); set('uFromLin', 0); draw(GD, W, H);
    return { tex: GD, A, W, H };
  }
  /* 大氣光估計（去朦朧用）：讀回低解析度影像，取暗通道最亮 0.2% 的平均色 */
  function estimateAtm(guideInfo) {
    const { A, W, H } = guideInfo; const R = work('gRead', W, H, 'u8');
    use(P.gread); set('uOutOrigin', [0, 0]); set('uOutSize', [W, H]); set('uWork', [W, H]); set('uSigma', 1); set('uIn', A); draw(R, W, H);
    const px = new Uint8Array(W * H * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, fb(R)); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const hist = new Uint32Array(256); for (let i = 3; i < px.length; i += 4) hist[px[i]]++;
    let need = Math.max(1, Math.round(W * H * 0.002)), th = 255; for (; th > 0; th--) { need -= hist[th]; if (need <= 0) break; }
    let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < px.length; i += 4) if (px[i + 3] >= th) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
    const sl = (v) => { v /= 255; return v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return n ? [sl(r / n), sl(g / n), sl(b / n)] : [1, 1, 1];
  }

  /* 讀回 RGBA8 */
  function readTex(tex, x, y, w, h) { const out = new Uint8Array(w * h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, fb(tex)); gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out); return out; }
  function downsample(tex, W, H) { const T = work('down', W, H, 'u8'); use(P.copy); set('uIn', tex); set('uWork', [W, H]); draw(T, W, H); return readTex(T, 0, 0, W, H); }

  function display(o) {
    use(P.display);
    set('uImg', o.img); set('uBefore', o.before); set('uDetail', o.detail); set('uOv', o.overlay);
    set('uCv', [canvas.width, canvas.height]); set('uView', [o.scale, o.tx, o.ty]); set('uImgSize', o.imgSize);
    set('uDetRect', o.detRect || [0, 0, 0, 0]); set('uHasDet', o.detail ? 1 : 0); set('uHasBefore', o.before ? 1 : 0); set('uHasOv', o.overlay ? 1 : 0);
    set('uSplit', o.split == null ? -1 : o.split); set('uBg', o.bg); set('uOvCol', o.ovCol || [0.85, 0.25, 0.2, 0.55]); set('uChecker', 1);
    draw(null, canvas.width, canvas.height);
  }
  function genMips(tex) { gl.bindTexture(gl.TEXTURE_2D, tex.t); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }

  return {
    init, geometry, outToSrc, srcToOut, runPasses, buildGuide, estimateAtm, readTex, downsample, display, mkTex, freeTex, uploadImage, work, genMips, wbGainJS, monotone,
    get gl() { return gl; }, get maxTex() { return maxTex; }, get HF() { return HF; }, LUMA,
  };
})();
