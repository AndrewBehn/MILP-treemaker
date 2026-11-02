# Mock of the TreeMaker app's API, for testing the front end in a browser without .NET. Geometry is real (exact
# distances, hull); solving is fake. Usage: python3 tools/mock_api.py 5099 src/TreeMaker.Web/wwwroot
import json, math, sys, time, random
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial

ROOT = sys.argv[2]

def tree(problem):
    edges = problem["edges"]; adj = {}
    for k, e in enumerate(edges):
        adj.setdefault(e["from"], []).append((e["to"], k)); adj.setdefault(e["to"], []).append((e["from"], k))
    leaves = sorted([v for v in adj if len(adj[v]) == 1])
    return edges, adj, leaves

def path_len(adj, lengths, a, b):
    stack = [(a, 0.0, None)]
    while stack:
        v, d, p = stack.pop()
        if v == b: return d
        for w, k in adj[v]:
            if w != p: stack.append((w, d + lengths[k], v))
    return 0

def pairs_of(problem, layout, scale, lengths=None):
    edges, adj, leaves = tree(problem)
    L = lengths or [float(e["length"]) for e in edges]
    pos = {p["leaf"]: (p["x"], p["y"]) for p in layout}
    out = []
    for i, a in enumerate(leaves):
        for b in leaves[i+1:]:
            l = path_len(adj, L, a, b); l0 = path_len(adj, [float(e["length"]) for e in edges], a, b)
            dx, dy = pos[a][0]-pos[b][0], pos[a][1]-pos[b][1]; d = math.hypot(dx, dy)
            out.append(dict(a=a, b=b, pathLength=l0, effectiveLength=l, dx=dx, dy=dy, distance=d, required=scale*l, slack=d-scale*l, tight=abs(d-scale*l) < 1e-6))
    return out

def exact_scale(problem, layout, lengths=None):
    ps = pairs_of(problem, layout, 1.0, lengths)
    return min(p["distance"]/p["effectiveLength"] for p in ps)

def border_layout(problem):
    edges, adj, leaves = tree(problem); n = problem["gridSize"]
    per = [(0,0)]
    pts = []
    for t in range(4*n):
        s, k = divmod(t, n)
        pts.append([(k,0),(n,k),(n-k,n),(0,n-k)][s])
    step = max(1, len(pts)//max(1,len(leaves)))
    return [dict(leaf=l, vertex=i, x=pts[(i*step) % len(pts)][0], y=pts[(i*step) % len(pts)][1]) for i, l in enumerate(leaves)]

def hull(points):
    pts = sorted(set(points))
    if len(pts) <= 2: return pts
    def cross(o,a,b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo=[];up=[]
    for p in pts:
        while len(lo)>=2 and cross(lo[-2],lo[-1],p)<=0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up)>=2 and cross(up[-2],up[-1],p)<=0: up.pop()
        up.append(p)
    return lo[:-1]+up[:-1]

def report(problem, layout, scale, lengths=None, force_valid=None):
    ps = pairs_of(problem, layout, scale, lengths)
    pos = {p["leaf"]: (p["x"], p["y"]) for p in layout}
    h = hull(list(pos.values()))
    hl = [next(l for l,v in pos.items() if v==q) for q in h]
    tight = [p for p in ps if p["tight"]]
    tk = {tuple(sorted((p["a"],p["b"]))) for p in tight}
    missing = [dict(a=hl[i], b=hl[(i+1)%len(hl)]) for i in range(len(hl)) if tuple(sorted((hl[i],hl[(i+1)%len(hl)]))) not in tk]
    valid = (not missing and len(hl) == len(pos)) if force_valid is None else force_valid
    if force_valid: missing = []
    return dict(valid=bool(valid), tightPairs=[dict(a=p["a"],b=p["b"]) for p in tight], hullLeaves=hl,
                polygons=[dict(leaves=hl, valid=bool(valid))], segments=[dict(a=p["a"],b=p["b"]) for p in tight],
                missingBoundary=missing, issues=[] if valid else [f"{len(missing)} boundary pairs are not tight."], hullArea=1, coveredArea=1 if valid else 0.6)

def edge_reports(problem, sigma=0.0):
    return [dict(edge=k, label=f'{e["from"]}–{e["to"]}', length=float(e["length"]), strain=sigma if k%2==0 else -sigma/2, newLength=float(e["length"])*(1+(sigma if k%2==0 else -sigma/2))) for k,e in enumerate(problem["edges"])]

def solve(api, problem):
    time.sleep(0.6)
    layout = border_layout(problem)
    m = exact_scale(problem, layout)
    ps = pairs_of(problem, layout, m)
    base = dict(binaryVariables=1234, constraints=500, nonzeros=9000, pairCount=len(ps), selectorsPerPair=80, leafCount=len(layout), variables=1300, integerVariables=10, continuousVariables=1, scaleUpperBound=m*1.2)
    msgs = ["Mock solve."] + (["Symmetry breaking: anchor leaf 1 (conditions C:6)."] if problem.get("symmetryBreaking") else []) + (["Started from the workbench layout."] if problem.get("startLayout") else [])
    if api == "pure":
        r = dict(stage=problem.get("stage","Scale"), status="Optimal", solverName="SCIP (mock)", objective=m, scale=m, bestBound=m, relativeGap=0, treeMakerScale=m/problem["gridSize"], layout=layout, pairs=ps, edgeLengths=[], violations=[], messages=msgs, model=base, metrics=dict(nodes=12, iterations=300))
        return dict(result=r, buildMilliseconds=20, solveMilliseconds=600, totalMilliseconds=620)
    if api == "optimized":
        cands = [m*0.8, m*0.9, m, m*1.1]
        return dict(status="Optimal", scale=m, upperBound=m*1.01, treeMakerScale=m/problem["gridSize"], seedScale=m*0.8, candidateCount=4, candidates=cands, maxTests=2,
                    tests=[dict(test=1, scale=m, answer="Yes", phases=[dict(windowed=True, outcome="Layout", rounds=[1,2])], solves=2, maxBinaries=40, milliseconds=100),
                           dict(test=2, scale=m*1.1, answer="No", phases=[dict(windowed=False, outcome="Infeasible", rounds=[1])], solves=1, maxBinaries=60, milliseconds=200)],
                    totalSolves=3, maxBinariesPerSolve=60, totalBinaries=100, milliseconds=600, layout=layout, pairs=ps, edgeLengths=[], violations=[], messages=msgs, baseModel=base,
                    hulls=[dict(a=p["a"], b=p["b"], tight=p["tight"], limit=int(p["required"]**2), radius=p["required"], dx=p["dx"], dy=p["dy"], vertices=[dict(x=2,y=0),dict(x=0,y=2),dict(x=-2,y=0),dict(x=0,y=-2)], crossableFacets=4) for p in ps[:5]])
    return dict(status="Feasible", scale=m, upperBound=m*1.2, continuousScale=m*1.05, treeMakerScale=m/problem["gridSize"], layout=layout, continuousLayout=[dict(leaf=p["leaf"], x=p["x"]+0.3, y=p["y"]-0.2) for p in layout],
                pairs=ps, edgeLengths=[], violations=[], messages=msgs, stages=[dict(stage=s, name=n, scale=m, milliseconds=100, solves=2, largestSolve=50, note="ok") for s,n in [(1,"Continuous"),(2,"Repair"),(3,"Search"),(4,"Finish")]],
                rounds=[dict(stage=2, kind="repair", scale=m, outcome="Layout", freeLeaves=4, variables=50, constraints=40, milliseconds=50)], totalSolves=8, largestSolve=50, milliseconds=600, tightBefore=2, tightAfter=4, polygonsValid=False, baseModel=base)

def layout_eval(api, body):
    problem = body["problem"]; pts = body["layout"]
    edges, adj, leaves = tree(problem)
    if sorted(p["leaf"] for p in pts) != leaves: raise ValueError("The layout does not place the tree's leaves.")
    lengths = body.get("edgeLengths")
    lay = [dict(leaf=p["leaf"], vertex=i, x=p["x"], y=p["y"]) for i,p in enumerate(pts)]
    m = body.get("scale") or exact_scale(problem, lay, lengths)
    ps = pairs_of(problem, lay, m, lengths)
    base = dict(binaryVariables=1234, constraints=500, nonzeros=9000, pairCount=len(ps), selectorsPerPair=80, leafCount=len(lay), variables=1300, integerVariables=10, continuousVariables=1, scaleUpperBound=m*1.2)
    common = dict(status="Feasible", scale=m, treeMakerScale=m/problem["gridSize"], layout=lay, pairs=ps, edgeLengths=edge_reports(problem, 0) if lengths else [], violations=[], messages=["Imported layout (mock)."])
    if api == "pure":
        return dict(result=dict(stage="Scale", solverName="Imported layout", objective=m, model=base, metrics=dict(nodes=0, iterations=0), **common), totalMilliseconds=0, buildMilliseconds=0, solveMilliseconds=0)
    if api == "optimized": return dict(upperBound=None, baseModel=base, symmetry=dict(anchor=None, siblingGroups=[], note=None), **common)
    return dict(upperBound=m*1.2, polygonsValid=False, baseModel=base, **common)

def analyze(api, problem):
    edges, adj, leaves = tree(problem); n=len(leaves); P=n*(n-1)//2
    base = dict(binaryVariables=P*80, constraints=4*P, nonzeros=P*200, pairCount=P, selectorsPerPair=80, leafCount=n, variables=P*80+2*n+1, integerVariables=2*n, continuousVariables=1, scaleUpperBound=1.5)
    if api == "pure": return dict(leaves=leaves, internalVertices=[], pairs=[], maxPathLength=1, minPathLength=1, scaleUpperBound=1.5, predictedModel=base)
    if api == "optimized": return dict(leaves=n, pairs=P, scaleUpperBound=1.5, candidateCount=40, distinctSquaredLengths=10, distinctPathLengths=4, maxTests=6, seedScale=1.0, worstCaseBinaries=P*8, atSeed=None, baseModel=base, symmetry=dict(anchor="1", siblingGroups=[], note=None))
    return dict(leaves=n, pairs=P, lpVariables=2*n+1, lpRows=P, repairWindowPoints=9, repairBooleans=9*n, scaleUpperBound=1.5, baseModel=base)

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_json(self, obj, code=200):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type","application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith("/api/example"):
            return self.send_json(dict(edges=[dict(**{"from":"1","to":"u","length":3}),dict(**{"from":"2","to":"u","length":2}),dict(**{"from":"u","to":"v","length":3}),dict(**{"from":"v","to":"3","length":2,"stretch":True}),dict(**{"from":"v","to":"4","length":4})], gridSize=9, targetScale=1.2))
        if self.path.startswith("/api/random"):
            edges=[{"from":f"L{k}","to":f"b{k//3}","length":1} for k in range(25)]+[{"from":f"b{k}","to":f"b{k+1}","length":1} for k in range(8)]
            return self.send_json(dict(edges=edges, gridSize=16))
        if self.path.startswith("/api/"): return self.send_json({"error":"no"}, 404)
        return super().do_GET()
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"null")
        parts = self.path.split("/")
        try:
            if self.path == "/api/cancel": return self.send_json(dict(cancelled=False))
            if self.path == "/api/cp/fold":   # the real algorithm's Python twin (tools/cp_fold.py)
                import cp_fold
                return self.send_json(cp_fold.fold(body.get("lines") or [], tolerance_degrees=body.get("toleranceDegrees")))
            if len(parts) == 4 and parts[2] in ("pure","optimized","scalable"):
                api, op = parts[2], parts[3]
                if op == "analyze": return self.send_json(analyze(api, body))
                if op == "solve": return self.send_json(solve(api, body))
                if op == "layout": return self.send_json(layout_eval(api, body))
            p = body["problem"]; lay = [dict(leaf=q["leaf"], vertex=i, x=q["x"], y=q["y"]) for i,q in enumerate(body["layout"])]
            if self.path == "/api/polygons": return self.send_json(report(p, lay, body["scale"], body.get("edgeLengths")))
            if self.path == "/api/strain-needed":
                bs = [(0.183, 0.0, -0.09)[k % 3] * (room[k] if (room := body.get("edgeRoom")) else 1) for k in range(len(p["edges"]))]
                return self.send_json(dict(boundaryStrains=bs, triangulationStrains=[], alreadyValid=False, boundaryStrain=0.183, boundaryValid=True, triangulationStrain=0.3, tightTargets=[dict(a=lay[0]["leaf"], b=lay[1]["leaf"])], solves=1, milliseconds=12, messages=["Making the boundary pairs tight needs ±0.183 (mock)."]))
            if self.path == "/api/complete":
                ok = (body.get("strainMax") or 0) >= 0.18
                after = report(p, lay, body["scale"], None, force_valid=ok)
                er = edge_reports(p, 0.18 if ok else 0.1)
                room = body.get("edgeRoom")
                if room:   # per-edge room: a locked edge keeps its length, the others strain within their room
                    if len(room) != len(p["edges"]): raise ValueError("There must be one edge room per edge.")
                    for e in er:
                        e["strain"] = max(-0.99, min(e["strain"] * room[e["edge"]], 0.18 * room[e["edge"]]))
                        e["newLength"] = e["length"] * (1 + e["strain"])
                return self.send_json(dict(status="Optimal", after=after, edgeLengths=er, targets=[dict(a=lay[0]["leaf"], b=lay[1]["leaf"], onBoundary=True, tightBefore=False, tightAfter=ok, distance=1, requiredAfter=1)], madeTight=1 if ok else 0, boundaryMadeTight=1 if ok else 0, boundaryTargets=1, totalStrain=0.5, largestStrain=0.18 if ok else 0.1, variables=20, binaries=5, constraints=30, milliseconds=40, messages=["Closed (mock)." if ok else "Not closed (mock)."]))
            if self.path == "/api/creases":
                edges = p["edges"]; n = p["gridSize"]
                cr = [dict(a=dict(x=lay[i]["x"], y=lay[i]["y"]), b=dict(x=n/2, y=n/2), kind=["Ridge","Hinge","Axial"][i%3]) for i in range(len(lay))]
                fac = [dict(edge=k, paper=[dict(x=0,y=0),dict(x=1,y=0),dict(x=0,y=1)], along=[0, float(e["length"]), float(e["length"])/2], elevation=[0,0,1]) for k,e in enumerate(edges)]
                return self.send_json(dict(built=True, creases=cr, facets=fac, problems=[], messages=["Built (mock)."], maxDepth=1, maxElevation=1, foldedHeight=1, milliseconds=30, edgePaperLengths=[float(e["length"]) for e in edges], pleatHeight=body.get("pleatHeight")))
        except Exception as ex:
            return self.send_json({"error": str(ex)}, 400)
        return self.send_json({"error":"unknown"}, 404)

ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), partial(H, directory=ROOT)).serve_forever()
