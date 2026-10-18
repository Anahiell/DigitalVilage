export const VILLAGES = [
 {id:'green-valley',name:'Green Valley',emoji:'🌲',description:'A remote mountain village with pristine forests but ageing infrastructure.',budget:108000,youth:180,internet:32,education:54,services:47,jobs:45,trust:72},
 {id:'riverstone',name:'Riverstone',emoji:'🌊',description:'A riverside farming town with a strong community and unreliable broadband.',budget:82000,youth:225,internet:48,education:62,services:53,jobs:43,trust:66},
 {id:'sunmeadow',name:'Sunmeadow',emoji:'☀️',description:'An ambitious village with a growing tourism industry but limited public services.',budget:99000,youth:205,internet:62,education:40,services:35,jobs:66,trust:60},
 {id:'pine-hills',name:'Pine Hills',emoji:'🏔️',description:'A traditional mountain village struggling to retain young residents.',budget:76000,youth:145,internet:25,education:58,services:44,jobs:34,trust:75}
];
export const ROLES=[
 {id:'mayor',label:'Mayor',note:'Coordinate decisions and approve investments'},
 {id:'finance',label:'Finance Officer',note:'Manage investment decisions'},
 {id:'digital',label:'Digital Officer',note:'Oversee digital infrastructure'},
 {id:'media',label:'Media Officer',note:'Investigate and publish information'},
 {id:'events',label:'Events Coordinator',note:'Organise the youth festival'},
 {id:'advisor-1',label:'Community Advisor',note:'Help with research and collaborative tasks'},
 {id:'advisor-2',label:'Youth Representative',note:'Support the village and its young residents'},
 {id:'advisor-3',label:'Culture Ambassador',note:'Represent local culture and tourism'}
];
export const INVESTMENTS=[
 {id:'fiber',name:'Fiber broadband',icon:'📡',price:29000,effects:{internet:35,jobs:6,trust:1},description:'Reliable connectivity for remote workers and households.'},
 {id:'school',name:'Digital skills academy',icon:'🎓',price:19000,effects:{education:32,jobs:5,trust:2},description:'Learning and employment opportunities for young people.'},
 {id:'center',name:'Community health hub',icon:'🏥',price:24000,effects:{services:32,trust:5},description:'Accessible services and a safer public space.'},
 {id:'startup',name:'Startup incubator',icon:'💻',price:26000,effects:{jobs:31,education:7},description:'Local innovation with higher ongoing operating costs.'},
 {id:'solar',name:'Community solar project',icon:'☀️',price:17500,effects:{services:8,jobs:8,trust:3},description:'Energy resilience for the local community.'}
];
export const ROUNDS=[
 {id:1,name:'Build Your Village',kicker:'DECISIONS SHAPE THE FUTURE',description:'Invest in essential services, keep the budget afloat and persuade young people to stay.',duration:1200},
 {id:2,name:'Information War',kicker:'DON’T BELIEVE EVERYTHING',description:'Review seven stories about each village. Choose the news you trust — and defend your reasoning.',duration:1200},
 {id:3,name:'Make Your Village Famous',kicker:'CREATE RESPONSIBLY',description:'Build a beautiful tourist invitation using a mobile-friendly editor. Some assets have hidden restrictions.',duration:1200},
 {id:4,name:'Festival Under Pressure',kicker:'COLLABORATION IS THE KEY',description:'Assign festival tasks, handle urgent crises and help each other meet the deadline.',duration:1800},
 {id:5,name:'The Security Surprise',kicker:'THINK BEFORE YOU CLICK',description:'Investigate a suspicious message and learn how phishing and personal data protection work.',duration:900}
];
export const MEDIA_ASSETS=[
 {id:'mountains',label:'Mountain landscape',symbol:'🏔️',kind:'photo',color:'#cdebd9',allowed:true},
 {id:'festival',label:'Festival lights',symbol:'🎉',kind:'photo',color:'#e5defa',allowed:true},
 {id:'nature',label:'Local nature',symbol:'🌻',kind:'photo',color:'#fff0bf',allowed:true},
 {id:'cycling',label:'Cycling route',symbol:'🚴',kind:'photo',color:'#c4e1ff',allowed:true},
 {id:'community',label:'Community market',symbol:'🍎',kind:'photo',color:'#ffe1ce',allowed:true},
 {id:'apple',label:'Apple™ logo (brand promotion)',symbol:'',kind:'brand',color:'#e8e8ee',allowed:false},
 {id:'bmw',label:'BMW™ logo (claiming sponsorship)',symbol:'BMW',kind:'brand',color:'#d6eafa',allowed:false},
 {id:'mcd',label:'McDonald’s™ logo (claiming sponsorship)',symbol:'M',kind:'brand',color:'#ffdf9b',allowed:false},
 {id:'cc',label:'CC BY licensed illustration',symbol:'CC',kind:'licensed',color:'#d5f9e6',allowed:true},
 {id:'unknown',label:'Unlicensed stock illustration',symbol:'★',kind:'licensed',color:'#ffd9d7',allowed:false}
];
export const FESTIVAL_TASKS=[
 {title:'Reserve event venue',type:'blue',role:'events',minutes:4,description:'Confirm a suitable meeting space with accessible entry.'},
 {title:'Publish festival programme',type:'blue',role:'media',minutes:5,description:'Share the programme and clear directions.'},
 {title:'Create festival Wi-Fi network',type:'blue',role:'digital',minutes:5,description:'Set up a reliable connection for presenters.'},
 {title:'Confirm funding',type:'blue',role:'finance',minutes:4,description:'Validate all expenses and commitments.'},
 {title:'Repair damaged water pipeline',type:'red',role:'digital',minutes:8,description:'Coordinate urgent infrastructure repairs before visitors arrive.'},
 {title:'Replace cancelled keynote speaker',type:'red',role:'events',minutes:8,description:'Contact a replacement speaker before the opening.'}
];

export const SECURITY_QUESTIONS=[
 {id:'sender',title:'The sender looks familiar',message:'“Digital Village Support” asks you to reply with your login PIN to keep your seat. The sender address is not the official game address.',options:[{id:'reply',text:'Reply with the PIN so the seat is not lost.'},{id:'verify',text:'Open the known game address and ask the host through a trusted channel.'},{id:'forward',text:'Forward the message and PIN to the whole village.'}],correct:'verify',explanation:'A display name is not proof of identity. Keep the PIN private and verify unexpected requests through the known site or host.'},
 {id:'url',title:'A convincing link',message:'A message displays the text “Open Digital Village”, but its destination uses a different domain. It promises an immediate budget bonus.',options:[{id:'open',text:'Open it because the visible link text names the game.'},{id:'share',text:'Ask everybody to try the link at the same time.'},{id:'known',text:'Use the saved game link or QR and check with the host.'}],correct:'known',explanation:'Link text can hide another destination. A promised reward is not evidence that the destination is trustworthy.'},
 {id:'privacy',title:'A sponsor wants the participant list',message:'An unfamiliar “festival sponsor” asks for every participant’s email address and PIN in a public group chat.',options:[{id:'decline',text:'Decline and ask the organiser to verify the request and purpose.'},{id:'emails',text:'Share the list because email addresses are not passwords.'},{id:'pins',text:'Share everything so the sponsor can help.'}],correct:'decline',explanation:'Do not disclose other participants’ personal information or credentials to an unverified requester.'},
 {id:'urgency',title:'Three minutes to act',message:'An urgent notice says the village account will be deleted unless you pay a small “verification fee” immediately.',options:[{id:'pay',text:'Pay quickly before the timer expires.'},{id:'pause',text:'Stop, verify the notice with the host, and avoid the payment link.'},{id:'card',text:'Enter a bank card but do not press the final button.'}],correct:'pause',explanation:'Urgency and payment pressure are warning signs. This workshop never needs participants’ bank details.'}
];

for(const asset of MEDIA_ASSETS){
 asset.usage=asset.allowed?'Workshop asset: reuse is permitted in this tourism campaign.':asset.kind==='brand'?'No sponsorship agreement is supplied. Do not present the brand as this campaign’s sponsor.':'No reuse licence or source is supplied. Obtain permission before publishing.';
 if(asset.id==='cc'){asset.requiresCredit=true;asset.credit='Digital Village workshop artwork (CC BY)';asset.usage='CC BY training asset: include the supplied credit when publishing.';}
}
