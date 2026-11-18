# Build a timeline (years -> games with labels) from spike data, for design sketches.
import json,re,collections,datetime as dt,sys
played=json.load(open('played.json')); ty={o['name']:o for o in json.load(open('trophy-years.json'))}
def hrs(s):
    m=re.match(r'P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?',s or '')
    D,H,M,S=[int(x or 0) for x in m.groups()]; return D*24+H+M/60+S/3600
def img(t,typ):
    for i in t.get('concept',{}).get('media',{}).get('images',[]):
        if i['type']==typ: return i['url']
games={}
for t in played:
    if 'app' in t['category']: continue
    k=str(t.get('concept',{}).get('id') or t['titleId'])
    g=games.setdefault(k,{'name':t['name'],'h':0,'first':t['firstPlayedDateTime'][:10],'last':t['lastPlayedDateTime'][:10],'plat':set(),
        'cover':img(t,'MASTER') or t['imageUrl'],'portrait':img(t,'PORTRAIT_BANNER'),'hero':img(t,'GAMEHUB_COVER_ART') or img(t,'BACKGROUND_LAYER_ART'),'logo':img(t,'LOGO')})
    g['h']+=hrs(t['playDuration']); g['first']=min(g['first'],t['firstPlayedDateTime'][:10]); g['last']=max(g['last'],t['lastPlayedDateTime'][:10])
    g['plat'].add('PS5' if 'ps5' in t['category'] else 'PS4' if 'ps4' in t['category'] else 'PS')
today=dt.date(2026,11,18)
def days_in(a,b,y):
    a=dt.date.fromisoformat(a); b=dt.date.fromisoformat(b); s=max(a,dt.date(y,1,1)); e=min(b,dt.date(y,12,31)); return max(0,(e-s).days+1)
def labels(g):
    fy,ly=int(g['first'][:4]),int(g['last'][:4])
    o=ty.get(g['name']); py={int(k):v for k,v in (o['perYear'] if o else {}).items()}
    years=sorted(set([fy,ly]+list(py)))
    if len(years)==1: return years[0],{years[0]:'Played'}
    if sum(py.values())>=3:
        main=max(years,key=lambda y:(py.get(y,0),-y)); out={}; last_sub=None
        for y in years:
            t=py.get(y,0)
            if t<2: lab='Brief visit'
            elif t>=5 and last_sub is not None and y-last_sub>1: lab='Replayed'
            elif py.get(y-1,0)>=2: lab='Continued'
            else: lab='Played'
            if t>=2: last_sub=y
            out[y]=lab
        return main,out
    main=max(years,key=lambda y:days_in(g['first'],g['last'],y))
    return main,{y:('Played' if y==main else 'Continued' if abs(y-main)==1 else 'Brief visit') for y in years}
yrs=collections.defaultdict(list); today=dt.date(2026,11,18)
def shares(g, years):
    o=ty.get(g['name']); py={int(k):v for k,v in (o['perYear'] if o else {}).items()}
    if sum(py.values())>=3: w={y:py.get(y,0)+1 for y in years}
    else: w={y:max(1,days_in(g['first'],g['last'],y)) for y in years}
    t=sum(w.values()); return {y:w[y]/t for y in years}
for k,g in games.items():
    main,ls=labels(g); sh=shares(g,list(ls))
    nowg=(today-dt.date.fromisoformat(g['last'])).days<=14
    if nowg and ls.get(today.year)=='Brief visit': ls[today.year]='Continued'  # never call what you're playing now a brief visit
    for y,l in ls.items():
        yrs[y].append({'id':k,'name':re.sub(r'\s*\[PS2 emulation\]|^Classic_|\s+PS4 & PS5$|\s*\(PlayStation5\)','',re.sub(r'[™®]','',g['name'])).replace('  ',' ').strip(),'h':round(g['h'],1),'yh':round(g['h']*sh[y],1),'label':l,'star':y==main,'tried':g['h']<1,'main':main,
          'first':g['first'],'last':g['last'],'plat':'/'.join(sorted(g['plat'])),
          'now':(today-dt.date.fromisoformat(g['last'])).days<=14 and y==2026,
          'cover':g['cover'],'portrait':g['portrait'],'hero':g['hero'],'logo':g['logo']})
out=[]
for y in sorted(yrs,reverse=True):
    gs=sorted(yrs[y],key=lambda x:(x['tried'],not x['star'],-x['h']))
    out.append({'year':y,'games':gs,'count':sum(1 for x in gs if not x['tried']),'tried':sum(1 for x in gs if x['tried']),
                'hours':round(sum(x['yh'] for x in gs))})
json.dump(out,open(sys.argv[1],'w'),indent=1)
for Y in out: print(Y['year'],Y['count'],'games',Y['tried'],'tried', Y['hours'],'h(main-year est)', '|', ', '.join(f"{g['name']}{'★' if g['star'] else ''}({g['label'][0]})" for g in Y['games'][:7]))
