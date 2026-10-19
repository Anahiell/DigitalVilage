// Incremental running balance, at the current population, before random events.
// Jobs earn 2.4 per tick but also cost 0.45; indicators saturate at 100.
export function projectForecast(v,item){
 const effects=Object.fromEntries(Object.entries(item.effects).map(([key,value])=>[key,Math.max(0,Math.min(100,Number(v[key])+value)-Number(v[key]))]));
 const n=key=>effects[key]||0;
 return {effects,budgetAfter:v.budget-item.price,netPerMinute:6*(1.95*n('jobs')+.45*n('trust')-.92*n('internet')-.75*n('education')-1.05*n('services'))};
}
