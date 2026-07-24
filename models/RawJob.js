const mongoose=require('mongoose');
const rawJobSchema=new mongoose.Schema({
    company:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Company",
    },
    title:String,
    location:String,
    salary:String,
    jobId:String,
    experience:String,
    description:String,
    applyLink:String,
    postedAt:Date,
    employmentType:{
    type:String,
    default:"Full-Time",
},
    scrapedAt: {
        type: Date,
        default: Date.now,
    },
    sources: [{
        sourceName: String,
        sourceChannel: String,
        telegramMessageId: Number,
        firstSeen: {
            type: Date,
            default: Date.now
        },
        lastSeen: {
            type: Date,
            default: Date.now
        }
    }],
    
    aiEvaluated: {
        type: Boolean,
        default: false,
    },
    
    aiMatched: {
        type: Boolean,
        default: false,
    },
    aiEvaluatedAt: Date,
},{timestamps:true});

rawJobSchema.index({ company: 1, jobId: 1 }, { unique: true });
rawJobSchema.index({ company: 1, applyLink: 1 });

module.exports=mongoose.model("RawJob",rawJobSchema);
