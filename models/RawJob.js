const mongoose=require('mongoose');
const rawJobSchema=new mongoose.Schema({
    company:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Company",
    },
    title:String,
    location:String,
    jobId:String,
    experience:String,
    description:String,
    applyLink:String,
    postedAt:Date,
    employmentType:{
    type:String,
    enum:["Internship", "Full-Time", "Contract"],
    default:"Full-Time",
},
    scrapedAt: {
        type: Date,
        default: Date.now,
    },
},{timestamps:true});

rawJobSchema.index({ company: 1, jobId: 1 });
rawJobSchema.index({ company: 1, applyLink: 1 });

module.exports=mongoose.model("RawJob",rawJobSchema);
