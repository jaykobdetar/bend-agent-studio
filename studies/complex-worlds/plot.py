"""Regenerate the study figure from published scores. Optional Matplotlib only."""
import json
from pathlib import Path
from matplotlib import pyplot as plt

root = Path(__file__).resolve().parent
studies = {s["study"]: s for s in json.loads((root / "results.json").read_text())}
panels = [
    ("locksmith-courier", "A  |  Locksmith Courier", "8 stations · environment steps",
     [("locksmith-8","random","Uniform"),("locksmith-8","q","Q"),("locksmith-8","dyna","Dyna-5")], 110),
    ("switchboard-2", "B  |  Switchboard", "2 cue bits · training episodes",
     [("switchboard-2-raw","q","Raw"),("switchboard-2-latest","q","Latest"),("switchboard-2-full","q","Full")], 1),
    ("storm-reserve", "C  |  Storm Reserve", "12 periods · training episodes",
     [("reserve-12x4","uniform","Uniform"),("reserve-12x4","q","Q"),("reserve-12x4","dyna-5","Dyna-5")], 15.5841884591),
]
plt.rcParams.update({"svg.fonttype":"none","svg.hashsalt":"bend-complex-worlds","font.size":9})
fig, axes = plt.subplots(1, 3, figsize=(10.8,3.35))
for ax,(study,title,unit,lines,top) in zip(axes,panels):
    data=studies[study]
    xs=range(len(data["checkpoints"]))
    ax.axhline(top,color="#94a3b8",linewidth=1,linestyle=":",zorder=0)
    for (game,arm,label),color,style,mark in zip(lines,["#6b7280","#127486","#b45309"],["--","-","-"],["s","o","^"]):
        row=next(x for x in data["rows"] if x["game"]==game and x["arm"]==arm)
        ax.plot(xs,row["validationMean"],label=label,linestyle=style,marker=mark,color=color,
                linewidth=1.8,markersize=4,clip_on=False)
    ax.set_title(title,loc="left",fontweight="bold",pad=11)
    ax.set_xlabel(unit,labelpad=7)
    ax.set_xticks(list(xs), [f'{b:,}' for b in data["checkpoints"]])
    ax.grid(axis="y",color="#e5e7eb",linewidth=.75)
    ax.legend(loc="upper center",bbox_to_anchor=(.5,-.29),ncol=3,frameon=False,handlelength=1.4,
              handletextpad=.35,columnspacing=1,fontsize=8)
    ax.spines[["top","right"]].set_visible(False); ax.margins(x=.04,y=.12)
axes[0].set_ylabel("Mean validation return")
fig.subplots_adjust(wspace=.28,bottom=.32,top=.87,left=.07,right=.98)
fig.savefig(root/"learning-curves.svg",metadata={"Date":None,"Title":"Validation learning curves for the three Bend challenge studies"})
# Matplotlib emits spaces at line ends inside numeric paths. Newlines already
# separate their coordinates, so normalize without changing the geometry.
out = root / "learning-curves.svg"
out.write_text("\n".join(line.rstrip() for line in out.read_text().splitlines()) + "\n")
