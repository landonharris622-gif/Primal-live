export async function api(url, opts={}){
  const headers = opts.headers || {"Content-Type":"application/json"};
  const res = await fetch(url, { credentials:"include", ...opts, headers });
  const txt = await res.text();
  let data;
  try{ data = JSON.parse(txt); }catch{ data = { raw: txt }; }
  if(!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function qs(sel){ return document.querySelector(sel); }
export function el(tag, props={}, children=[]){
  const n = document.createElement(tag);
  for(const [k,v] of Object.entries(props)){
    if(k==="class") n.className=v;
    else if(k==="html") n.innerHTML=v;
    else n.setAttribute(k,v);
  }
  for(const c of children) n.appendChild(typeof c==="string"?document.createTextNode(c):c);
  return n;
}
export function sessionId(){
  const k="pl_session_id";
  let v=localStorage.getItem(k);
  if(!v){ v = crypto.randomUUID(); localStorage.setItem(k,v); }
  return v;
}
