"""Public policy evidence acquisition; originals cached, no invented routing inputs.

Run via node scripts/policy-evidence-run.mjs fetch|prepare|validate|all.
Public downloads only. Reuses the existing public-data Python dependencies.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import requests
import openpyxl
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/public/archive/policy-evidence'
OUT = ROOT / 'data/public/policy-evidence'
TRANSFORM = 'policy-evidence-1.0'
HDC = 'https://gis.hdc.mv/server/rest/services/Hosted/'
TREE = 'https://services7.arcgis.com/TGjun5cqf5Jwp2Ad/arcgis/rest/services/TREEPOINTS/FeatureServer/63'
LAYERS = [
    dict(id='hdc-pavements', title='Hulhumalé pavements', url=HDC+'Transportation_v2/FeatureServer/5', fields=['objectid','road','width','zone','phase'], referencePeriod='Layer last edited May 2025', units='Pavement polygons; widths in source units not independently verified', limitations=['Mapped pavement footprints do not prove present condition, continuity, crossings, or wheelchair accessibility.','Coverage is Hulhumalé only; not used to invent routable pedestrian connections.']),
    dict(id='hdc-masterplan', title='Hulhumalé masterplan lots', url=HDC+'Masterplan_Redesign/FeatureServer/0', fields=['fid','landuse','phase','area_sqm'], referencePeriod='Revision 20 May 2025', units='Planned lot polygons; area_sqm in square metres', limitations=['Land-use designation is a plan, not evidence of construction or occupancy.','No verified completion dates, unit counts or residents per lot; housing redistribution remains an editable scenario assumption.']),
    dict(id='hdc-trees', title='Hulhumalé tree inventory', url=TREE, fields=None, referencePeriod='Inventory published for Environment Day 2026; per-tree dates vary', units='Individual tree records', limitations=['Tree points do not establish canopy coverage, shaded footpaths, thermal exposure or usable waiting-area shade.','Species/measurement availability varies; no heat reduction is calculated from proximity alone.']),
    dict(id='hdc-accessibility-audit', title='Hulhumalé accessibility observations', url=HDC+'service_4ae729ee6f77452899b7d08c65a4ded5/FeatureServer/0', fields=['objectid','name_of_place','location_zone','category','ownership','service_category','service_education_category','step_free_entrance','ramp_available','ramp_usable','door_accessible','accessible_entry','curb_ramps','continuous_access','surface','step_free_continuity','pathway_width','surface_condition','obstructions_present','continuous_movement','shade_availability','created_date','last_edited_date'], referencePeriod='Dated HDC survey records, snapshot October 2026', units='Survey observation points with categorical responses', limitations=['Survey point responses apply to that observation, not every approach or an entire wheelchair route.','Survey dates and completeness vary; no surveyed-by, user, security, or free-text personal fields are exposed.'])
]
DOWNLOADS = [
    dict(id='rtl-public-vessel-catalog',title='RTL public vessel route catalog',url='https://bo.rtl.mv:4455/maldives/api/booking/v1/vessel/routedetails',file='rtl-vessel-catalog.json',publisher='RTL / MTCC',referencePeriod='Retrieval snapshot; calendar validity not published',coverage='Vilimalé, Gulhifalhu and Thilafushi published vessel routes',units='Routes, terminals, unqualified departure lists and MVR fares'),
    dict(id='rtl-public-bus-snapshot',title='RTL public bus route snapshot',url='https://bo.rtl.mv:4455/maldives/api/booking/v2/bus/routedetails',file='rtl-bus-snapshot.json',publisher='RTL / MTCC',referencePeriod='Retrieval snapshot; complete daily/calendar coverage not published',coverage='Greater Malé bus routes',units='Routes, stops and returned departure times'),
    dict(id='mtcc-vilimale-calendar-2026',title='Vilimalé ferry service frequency calendar 2026',url='https://mtcc.mv/wp-content/uploads/2025/12/Vili-male-Ferry-Schedule-2026-V1.pdf',file='vilimale-calendar-2026.pdf',publisher='MTCC',referencePeriod='Effective 21 March 2026; expiry not stated',coverage='Malé–Vilimalé',units='Day-type frequency intervals, minutes'),
    dict(id='mtcc-thilafushi-calendar-2026',title='Thilafushi ferry departure calendar 2026',url='https://mtcc.mv/wp-content/uploads/2021/07/Thilafushi-Ferry-Schedule-2026-V2.pdf',file='thilafushi-calendar-2026.pdf',publisher='MTCC',referencePeriod='Effective 24 August 2026; expiry not stated',coverage='Malé–Thilafushi',units='Direction-specific local departure times'),
    dict(id='mtcc-gulhifalhu-calendar-2026',title='Gulhifalhu ferry departure calendar 2026',url='https://mtcc.mv/wp-content/uploads/2021/07/Gulhifalhu-Ferry-Schedule-2026-V1.pdf',file='gulhifalhu-calendar-2026.pdf',publisher='MTCC',referencePeriod='Effective 21 March 2026; expiry not stated',coverage='Malé–Gulhifalhu',units='Direction-specific local departure times'),
    dict(id='mtcc-hulhumale-calendar-2024',title='Hulhumalé ferry historical departure calendar',url='https://mtcc.mv/wp-content/uploads/2021/07/Hulhumale-Ferry-Schedule-16-4-2024.pdf',file='hulhumale-calendar-2024.pdf',publisher='MTCC',referencePeriod='Filename dated 16 April 2024; present validity requires confirmation',coverage='Malé–Hulhumalé',units='Direction-specific local departure times'),
    dict(id='moe-school-statistics-2023',title='School Statistics 2023/2024',url='https://www.moe.gov.mv/storage/files/statistics/1760857367051-2023-2024%20School%20Statistics.pdf',file='school-statistics-2023.pdf',publisher='Ministry of Education',referencePeriod='November 2023',coverage='Maldives, with Greater Malé locality totals',units='Schools and enrolled students by institution/grade/sector'),
    dict(id='mbs-constituency-population-2022',title='Census 2022 constituency population indicators',url='https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2025/08/parliment_indicator-pop.xlsx',file='constituency-population.xlsx',publisher='Maldives Bureau of Statistics',referencePeriod='Census 2022; published August 2025',coverage='Maldives constituencies',units='People counted in constituencies; cohort-specific denominators'),
    dict(id='mbs-constituency-education-2022',title='Census 2022 constituency education indicators',url='https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2025/08/parliment_indicator-edu.xlsx',file='constituency-education.xlsx',publisher='Maldives Bureau of Statistics',referencePeriod='Census 2022; published August 2025',coverage='Maldives constituencies',units='Maldivian population counted by education status'),
    dict(id='mbs-constituency-employment-2022',title='Census 2022 constituency employment indicators',url='https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2025/08/parliment_indicator-emp.xlsx',file='constituency-employment.xlsx',publisher='Maldives Bureau of Statistics',referencePeriod='Census 2022; published August 2025',coverage='Maldives constituencies',units='Maldivian population counted by employment status'),
    dict(id='mbs-hies-expenditure-2019',title='HIES 2019 expenditure indicators',url='https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2021/05/HIES2019-Expenditure-indicators.xlsx',file='hies-expenditure.xlsx',publisher='Maldives Bureau of Statistics',referencePeriod='HIES 2019; published May 2021',coverage='National, Malé, and atoll aggregates',units='Nominal monthly household expenditure in MVR'),
    dict(id='mbs-hies-expenditure-methods-2019',title='HIES 2019 household expenditure report',url='https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2021/05/HIES2019-Expenditure.pdf',file='hies-expenditure.pdf',publisher='Maldives Bureau of Statistics',referencePeriod='HIES 2019; published May 2021',coverage='National, Malé, and atoll aggregates',units='Nominal monthly household expenditure in MVR'),
    dict(id='hdc-landuse-plan-2025',title='Hulhumalé Land Use Plan',url='https://gis.hdc.mv/assets/downloads/Land%20Use%20Plan.pdf',file='hdc-landuse-plan.pdf',publisher='Housing Development Corporation',referencePeriod='27 October 2025',coverage='Hulhumalé Phases 1 and 2',units='Planned hectares, housing units and estimated capacity'),
    dict(id='mbs-igmh-utilisation-2025',title='In-patient health care at IGMH, 2010–2025',url='https://statisticsmaldives.gov.mv/yearbook/2026/wp-content/uploads/sites/13/2026/05/6.6.xlsx',file='igmh-utilisation.xlsx',publisher='Maldives Bureau of Statistics; source IGMH',referencePeriod='2010–2025',coverage='IGMH institutional annual totals',units='Beds, encounters, admissions, bed-days, occupancy percent, days'),
]

def now(): return datetime.now(timezone.utc).isoformat()
def encoded(value): return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp');temp.write_bytes(encoded(value));temp.replace(path)
def get(url,**params):
    response=requests.get(url,params=params or None,timeout=45,headers={'User-Agent':'MobilitySandboxMV/1.0 public-evidence-cache'})
    response.raise_for_status()
    if 'json' in params.get('f',''):
        value=response.json()
        if 'error' in value: raise ValueError(str(value['error']))
    return response
def record(source,response,file):
    body=response.content
    RAW.mkdir(parents=True,exist_ok=True)
    # Validate before replacing a last-known local source.
    if file.endswith('.xlsx'): openpyxl.load_workbook(__import__('io').BytesIO(body),read_only=True,data_only=True).close()
    elif file.endswith('.pdf') and not body.startswith(b'%PDF'): raise ValueError('Not a PDF')
    elif file.endswith('.json') or file.endswith('.geojson'): response.json()
    path=RAW/file;temp=path.with_suffix(path.suffix+'.tmp');temp.write_bytes(body);temp.replace(path)
    return dict(id=source['id'],title=source['title'],url=source['url'],publisher=source.get('publisher','Housing Development Corporation'),referencePeriod=source['referencePeriod'],retrievedAt=now(),checksum=hashlib.sha256(body).hexdigest(),coverage=source.get('coverage','Hulhumalé'),units=source['units'],licenseStatus='Publicly readable official data; explicit reuse licence not stated. Attribution required; confirm terms with publisher before redistribution.',transformationVersion=TRANSFORM,rawPath=str(path.relative_to(ROOT)).replace('\\','/'),bytes=len(body))
def download(source): return [record(source,get(source['url']),source['file'])]
def layer_download(source):
    metadata=get(source['url'],f='json'); meta=metadata.json()
    catalog=[record(source,metadata,source['id']+'-metadata.json')]
    oid=meta['objectIdField']
    ids=get(source['url']+'/query',f='json',where='1=1',returnIdsOnly='true').json()['objectIds']
    fields=source['fields']
    if fields is None:
        # Tree inventory public facts only; exclude account/user fields.
        fields=[x['name'] for x in meta['fields'] if not any(w in x['name'].lower() for w in ['user','edited_by','created_by','globalid','photo','attachment'])]
    fields=list(dict.fromkeys([oid]+fields))
    chunk=100 if source['id']=='hdc-trees' else 500
    for start in range(0,len(ids),chunk):
        subset=sorted(ids)[start:start+chunk]
        response=get(source['url']+'/query',f='geojson',objectIds=','.join(map(str,subset)),outFields=','.join(fields),outSR=4326,returnGeometry='true')
        body=response.json()
        if len(body.get('features',[])) != len(subset): raise ValueError('Incomplete ArcGIS page')
        page=dict(source,id=f"{source['id']}-page-{start//chunk}",title=source['title']+' features',url=response.url)
        catalog.append(record(page,response,f"{source['id']}-{start//chunk}.geojson"))
    return catalog
def fetch(selected=None):
    previous=json.loads((OUT/'sources.json').read_text('utf-8')) if (OUT/'sources.json').exists() else {'sources':[],'failures':[]}
    retained={row['id']:row for row in previous['sources']}
    failures=[failure for failure in previous.get('failures',[]) if selected and failure['id'] not in selected]
    with ThreadPoolExecutor(max_workers=5) as pool:
        items=[item for item in LAYERS+DOWNLOADS if not selected or item['id'] in selected]
        if selected and len(items)!=len(selected):raise ValueError('Unknown source ID')
        futures={pool.submit(layer_download if 'fields' in item else download,item):item for item in items}
        for future in as_completed(futures):
            item=futures[future]
            try:
                rows=future.result()
                if 'fields' in item:
                    for key in list(retained):
                        if key==item['id'] or key.startswith(item['id']+'-page-'):del retained[key]
                for row in rows:retained[row['id']]=row
                print(f"Cached {item['id']}: {len(rows)} files")
            except Exception as error:
                failures.append(dict(id=item['id'],url=item['url'],attemptedAt=now(),reason=str(error)));print(f"Unavailable {item['id']}: {error}")
    write(OUT/'sources.json',dict(generatedAt=now(),sources=list(retained.values()),failures=failures))

def compact_coordinates(value):
    if isinstance(value,list):return [compact_coordinates(item) for item in value]
    return round(value,7) if isinstance(value,(int,float)) else value
def has_coordinates(value):
    return bool(value) and (isinstance(value[0],(int,float)) or all(has_coordinates(item) for item in value))
def in_coverage(value):
    if isinstance(value[0],list):return all(in_coverage(item) for item in value)
    return 73.4<=value[0]<=73.65 and 4.1<=value[1]<=4.35

def workbook(file):return openpyxl.load_workbook(RAW/file,read_only=True,data_only=True)
def numeric(value):return value if isinstance(value,(int,float)) else None
def observation(id,metric,value,unit,period,geography,source,definition):
    return dict(id=id,metric=metric,value=numeric(value),unit=unit,referencePeriod=str(period),geography=geography,sourceId=source,definition=definition)

def service_calendars(catalog):
    """Operator evidence only: departures are not arrival times or ferry crossings."""
    calendars=[]
    calendar_files=[('vilimale','mtcc-vilimale-calendar-2026','vilimale-calendar-2026.pdf','2026-03-21'),('thilafushi','mtcc-thilafushi-calendar-2026','thilafushi-calendar-2026.pdf','2026-08-24'),('gulhifalhu','mtcc-gulhifalhu-calendar-2026','gulhifalhu-calendar-2026.pdf','2026-03-21'),('hulhumale','mtcc-hulhumale-calendar-2024','hulhumale-calendar-2024.pdf',None)]
    for route,source_id,file,effective in calendar_files:
        if source_id not in catalog:continue
        with pdfplumber.open(RAW/file) as pdf:texts=[page.extract_text() or '' for page in pdf.pages]
        daytypes=[]
        for index,text in enumerate(texts):
            if route=='vilimale':
                label=['Sunday–Thursday','Friday','Saturday and other holidays'][index]
                weekdays=[[7,1,2,3,4],[5],[6]][index]
                windows=[]
                for line in text.splitlines():
                    match=re.fullmatch(r'(\d{2}:\d{2}) (\d{2}:\d{2}) (\d+) (MIN|HR)',line)
                    if match:windows.append(dict(start=match[1],end=match[2],headwayMinutes=int(match[3])*(60 if match[4]=='HR' else 1)))
                assert len(windows)==[8,9,8][index],f'Review Vilimalé original page {index+1}'
                breaks=[dict(start='12:00',end='13:30',reason='Friday prayer break')] if index==1 else []
                if index==1:assert '12:00 13:30 Friday Prayer Break' in text
                daytypes.append(dict(label=label,isoWeekdays=weekdays,includesPublicHolidays=index==2,frequencyWindows=windows,noServiceWindows=breaks,unknownWindows=[dict(start='17:20',end='17:30',reason='Gap between printed timetable rows')] if index==2 else []))
            else:
                pairs=re.findall(r'^(\d{2}:\d{2}) (\d{2}:\d{2})$',text,re.M)
                expected={'thilafushi':[14,13],'gulhifalhu':[7],'hulhumale':[9]}[route][index]
                assert len(pairs)==expected,f'Review {route} original page {index+1}'
                if route=='hulhumale':label='Weekdays and weekend';weekdays=[1,2,3,4,5,6,7]
                else:label='Saturday–Thursday' if index==0 else 'Friday';weekdays=[6,7,1,2,3,4] if index==0 else [5]
                daytypes.append(dict(label=label,isoWeekdays=weekdays,includesPublicHolidays=None,departuresFromMale=[p[0] for p in pairs],departuresFromIsland=[p[1] for p in pairs]))
        if route=='gulhifalhu':
            assert 'No scheduled ferries to Gulhifalhu on Fridays.' in texts[0]
            daytypes.append(dict(label='Friday',isoWeekdays=[5],includesPublicHolidays=None,noScheduledService=True,departuresFromMale=[],departuresFromIsland=[]))
        calendars.append(dict(id='mtcc-calendar:'+route,route=route,mode='ferry',sourceId=source_id,timezone='Indian/Maldives',effectiveFrom=effective,validUntil=None,dayTypes=daytypes,crossingMinutes=None,routingEligible=False,limitations=['These columns are departures in opposite directions, not departure/arrival pairs. No crossing time is published.','No dated cancellation or public-holiday exception calendar verified.']+(['Current operator confirmation required for this historical document.'] if route=='hulhumale' else [])+(['Saturday timetable explicitly leaves 17:20–17:30 unspecified; no frequency is interpolated across that gap.'] if route=='vilimale' else [])))
    result=dict(schemaVersion=1,generatedAt=now(),sources=[catalog[s] for s in [item['sourceId'] for item in calendars]],calendars=calendars,limitations=['Public RTL route-detail GET supplies a retrieval snapshot, without verified recurring bus calendar parameters. It is not assumed to cover morning, Friday or all future services.','API vessel station departure lists have no paired arrivals or stated validity and may differ from published PDFs; official dated PDFs take precedence as calendar evidence.','Calendar evidence does not by itself enable ferry routing: verified crossing times and stop reconciliation are still required.'])
    result['version']='service-calendar-evidence-'+hashlib.sha256(encoded({k:v for k,v in result.items() if k!='generatedAt'})).hexdigest()[:16]
    write(OUT/'service-calendars.json',result)
    return calendars

def prepare():
    validate()
    registry=json.loads((OUT/'sources.json').read_text('utf-8'))
    catalog={source['id']:source for source in registry['sources']}
    calendars=service_calendars(catalog)
    layers=[];gaps=[]
    for layer in LAYERS:
        pages=sorted([s for s in catalog.values() if s['id'].startswith(layer['id']+'-page-')],key=lambda s:int(s['id'].rsplit('-',1)[1]))
        features=[];source_record_count=0
        metadata_path=RAW/(layer['id']+'-metadata.json')
        meta=json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
        domains={f['name']:{str(c['code']):c['name'] for c in (f.get('domain') or {}).get('codedValues',[])} for f in meta.get('fields',[])}
        for source in pages:
            raw=json.loads((ROOT/source['rawPath']).read_text('utf-8'))
            source_record_count+=len(raw['features'])
            for feature in raw['features']:
                props=feature['properties']
                oid=props.get(meta.get('objectIdField','objectid'))
                if not feature.get('geometry') or not has_coordinates(feature['geometry'].get('coordinates')) or not in_coverage(feature['geometry']['coordinates']):continue
                properties={key:domains.get(key,{}).get(str(value),value) for key,value in props.items() if value is not None and value != ''}
                # Source measures retained as context only. No shade, walkability or housing model is implied.
                properties.update(id=f"{layer['id']}:{oid}",sourceId=source['id'])
                features.append(dict(type='Feature',id=properties['id'],properties=properties,geometry=dict(type=feature['geometry']['type'],coordinates=compact_coordinates(feature['geometry']['coordinates']))))
        if not pages:gaps.append(f"{layer['title']}: no validated local data; upstream unavailable.")
        assert len({feature['id'] for feature in features})==len(features),f"Duplicate IDs in {layer['id']}"
        limitations=list(layer['limitations'])
        if source_record_count>len(features):limitations.append(f"{source_record_count-len(features)} source records lack usable geometry in the study area and are retained in the original archive, excluded from precise map display.")
        layers.append(dict(id=layer['id'],title=layer['title'],sourceIds=[layer['id']]+[s['id'] for s in pages] if layer['id'] in catalog else [s['id'] for s in pages],coverage='Hulhumalé',referencePeriod=layer['referencePeriod'],recordCount=len(features),sourceRecordCount=source_record_count,unlocatedRecords=source_record_count-len(features),status='partial' if features else 'unavailable',limitations=limitations,features=dict(type='FeatureCollection',features=features)))
    baseline=json.loads((ROOT/'data/public/planning-baseline.json').read_text('utf-8'))
    mapped=[f for f in baseline.get('facilities',[]) if f.get('kind')=='school' and f.get('generalAccessEligible',f.get('analysisEligible',False))]
    # The operating-status audit supplies the eligible mapped-site count; no unlocated school is placed at a centroid.
    audit=json.loads((ROOT/'data/public/facility-operation-review.json').read_text('utf-8'))
    mapped_count=audit.get('summary',{}).get('generalSchoolEligibleCount',baseline.get('facilityOperationReview',{}).get('generalSchoolEligibleCount',len(mapped)))
    with pdfplumber.open(RAW/'school-statistics-2023.pdf') as pdf:
        school_text=pdf.pages[11].extract_text() or ''
        school_row=next(line for line in school_text.splitlines() if line.startswith('Greater Male'))
        values=[int(token.replace(',','')) for token in re.findall(r'\d[\d,]*',school_row)]
        assert values==[19,13477,12720,3,1516,1708,20,4791,4624,42,19784,19052,38836], 'School table changed; review original PDF page 12'
        alternate=pdf.pages[9].extract_text() or ''
        assert '37,707' in alternate,'Review key-stage reconciliation on PDF page 10'
    school=dict(referencePeriod='November 2023',publishedSchools=values[9],publishedEnrollment=values[12],sectorCounts=[dict(sector='Government',schools=19,enrollment=26197),dict(sector='Community',schools=3,enrollment=3224),dict(sector='Private',schools=20,enrollment=9415)],mappedEligibleLocations=mapped_count,matchedInstitutions=None,sourceIds=['moe-school-statistics-2023'],limitations=['Published 42 schools is a 2023 regional institution count, while the mapped count is a 2026 eligible-site subset; their difference is not a verified missing-school count.','Statistics PDF is aggregate, without a named institution roster or coordinates. Reconcile against the directory and grades/admissions before adding destinations.','Page 10 key-stage locality subtotal is 37,707, while pages 12 and 36–37 report 38,836. Use the explicit sector/locality table and retain this conflict; do not assign its enrollment to individual schools.'])
    constituencies=[]
    w=workbook('constituency-population.xlsx')
    for row in list(w.active.values)[4:21]:
        name=row[0]
        assert isinstance(name,str) and row[1]==row[4]+row[7] and row[1]==row[2]+row[3]
        assert row[4]==sum(row[12:16]),name
        island='hulhumale' if name.startswith('Hulhumaale') else 'vilimale' if name.startswith('Vilimaale') else 'male'
        constituencies.append(dict(id=re.sub('[^a-z0-9]+','-',name.lower()).strip('-'),name=name,islandId=island,population=row[1],maldivianPopulation=row[4],foreignPopulation=row[7],malePopulation=row[2],femalePopulation=row[3],ageGroupsMaldivian=[dict(label='0–17',value=row[12]),dict(label='18–35',value=row[13]),dict(label='36–64',value=row[14]),dict(label='65+',value=row[15])],sourceId='mbs-constituency-population-2022',boundaryMatched=False))
    w.close()
    observations=[]
    w=workbook('hies-expenditure.xlsx');rows=list(w.active.values);w.close()
    for geo,col in [('Republic',1),('Malé',2),('Atolls',3)]:
        for index,metric,unit,definition in [(7,'Average monthly household expenditure','MVR/household/month','Nominal consumption expenditure among expenditure-reporting households; excludes imputed rent and in-kind receipts.'),(8,'Median monthly household expenditure','MVR/household/month','2019 household consumption-expenditure median; not current income.'),(9,'Monthly per-capita expenditure','MVR/person/month','Geographically coarse 2019 expenditure benchmark, not neighborhood income.'),(10,'Median monthly per-capita expenditure','MVR/person/month','Optional fare-affordability denominator; user must decide if this historical coarse benchmark is appropriate.'),(21,'Transport share of expenditure','percent','Broad transport category; includes more than public-transport fares.'),(35,'Average monthly household transport expenditure','MVR/household/month','Transport-expenditure-reporting household category average; not a route-specific fare budget.'),(49,'Monthly per-capita transport expenditure','MVR/person/month','Published broad transport expenditure, not observed transit trips.'),(69,'Poorest-quintile monthly per-capita expenditure','MVR/person/month','2019 expenditure quintile mean, not a located income or household count.')]:
            value=rows[index][col]
            if unit=='percent' and value is not None:value*=100
            observations.append(observation(f'hies:{geo}:{index}',metric,value,unit,'2019',geo,'mbs-hies-expenditure-2019',definition))
    w=workbook('igmh-utilisation.xlsx');rows=list(w.active.values);w.close()
    for year in [2024,2025]:
        col=rows[3].index(year)
        for index,metric,unit,definition in [(5,'IGMH hospital beds','beds at year-end','Year-end bed count; not immediately available beds. Do not add this to a separate Dharumavantha campus total.'),(6,'IGMH out-patient activity','reported encounters/year','Published out-patients count; repeat visits and the source definition prevent interpreting it as unique patients or neighborhood demand.'),(7,'IGMH in-patient activity','reported admissions/year','Annual hospital admissions; does not establish service-specific appointment availability.'),(8,'IGMH in-patient days','patient-days/year','Institutional utilization context, not resident demand.'),(9,'IGMH average duration of stay','days','Published annual average duration of stay.'),(10,'IGMH occupancy ratio','percent','Published ratio; missing values remain unavailable and are not derived from year-end beds.')]:
            observations.append(observation(f'igmh:{year}:{index}',metric,rows[index][col],unit,year,'IGMH','mbs-igmh-utilisation-2025',definition))
    gaps.extend([f'{len(calendars)} public MTCC ferry calendars cached separately with distinct day types. Crossing times remain unavailable, and full recurring bus calendars are not verified by the RTL snapshot. Missing morning services remain unknown.','Official constituency boundaries are not matched. Constituency counts are context only; origin gains and demographic ratios are not spatially assigned from them.','HDC development phases identify planning zones, without verified completion dates or occupied unit counts; optional population redistribution must conserve the official island total and remain a scenario assumption.','Puddling storymaps are public, but event FeatureServer returns error 499 Token Required; historical events do not define flood probability.','IGMH operator site returned HTTP 403 during acquisition. The cached MBS Yearbook 2026 IGMH table provides official utilization through 2025, with 2024 occupancy explicitly unavailable.'])
    gaps.extend(f"Source refresh failed for {f['id']}: {f['reason'].split(' for url:')[0]}; last validated local source retained where available." for f in registry.get('failures',[]))
    bundle=dict(schemaVersion=1,generatedAt=now(),stale=bool(registry.get('failures')),sources=list(catalog.values()),layers=layers,schoolCompleteness=school,observations=observations,constituencies=constituencies,gaps=gaps,agencyRequests=['MTCC/RTL: full bus and ferry service calendars, directions, stop times, validity and exceptions; aggregate boardings and vehicle loads by stop/time.','HDC/council: audited facility entrances, step-free boarding paths, crossings, pavement continuity, completion dates and occupied housing units.','Health and Education ministries: suitable services, grades, public/private admissions, current operating hours, staffing and capacity by facility.','MTCC/STO/STELCO: local vehicle, labor, energy, maintenance and route-specific operating costs; observed arrival-time reliability.','MBS/Elections Commission: official boundaries matching Census constituency indicators and clear cohort/nationality definitions.'])
    bundle['version']='policy-evidence-'+hashlib.sha256(encoded({key:value for key,value in bundle.items() if key not in ['generatedAt','stale']})).hexdigest()[:16]
    write(OUT/'bundle.json',bundle)
    print('Prepared '+bundle['version']+': '+', '.join(f"{l['recordCount']} {l['id']}" for l in layers))
def validate():
    registry=json.loads((OUT/'sources.json').read_text('utf-8'))
    for source in registry['sources']:
        content=(ROOT/source['rawPath']).read_bytes()
        assert hashlib.sha256(content).hexdigest()==source['checksum'],source['id']
    print(f"Validated {len(registry['sources'])} cached originals")

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['fetch','prepare','validate','all']);parser.add_argument('--sources',help='Optional comma-separated source IDs for an incremental fetch');args=parser.parse_args()
    if args.command in ['fetch','all']:fetch(set(args.sources.split(',')) if args.sources else None)
    if args.command in ['prepare','all']:prepare()
    if args.command in ['validate','all']:validate()
