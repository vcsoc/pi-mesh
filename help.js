const search=document.querySelector("[data-doc-search]");
const status=document.getElementById("search-status");
const sections=[...document.querySelectorAll("[data-search]")];
const links=[...document.querySelectorAll('.sidebar nav a[href^="#"]')];
const searchable=section=>`${section.dataset.search||""} ${section.textContent||""}`.toLocaleLowerCase();

function filterDocumentation(){
  const query=search.value.trim().toLocaleLowerCase();
  let visible=0;
  for(const section of sections){
    const match=!query||searchable(section).includes(query);
    section.hidden=!match;
    if(match)visible++;
  }
  for(const link of links){
    const target=document.querySelector(link.getAttribute("href"));
    link.hidden=Boolean(query&&target?.hidden);
  }
  status.textContent=query?`${visible} matching section${visible===1?"":"s"}`:"All documentation shown";
}
search.addEventListener("input",filterDocumentation);
search.addEventListener("keydown",event=>{if(event.key==="Escape"){search.value="";filterDocumentation();search.blur()}});

const observed=links.map(link=>document.querySelector(link.getAttribute("href"))).filter(Boolean);
const observer=new IntersectionObserver(entries=>{
  const current=entries.filter(entry=>entry.isIntersecting&&!entry.target.hidden).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
  if(!current)return;
  for(const link of links)link.classList.toggle("active",link.getAttribute("href")===`#${current.target.id}`);
},{rootMargin:"-18% 0px -68%",threshold:[0,.15,.5]});
for(const section of observed)observer.observe(section);
